import AppKit
import Combine
import Foundation
import SwiftUI

let toolDirectory = "/Users/afly/Documents/Codex/2026-06-04/figma-figma/outputs/figma-qa-screenshot-tool（截图工具）"
let materialLibraryURL = "https://my.feishu.cn/wiki/P9ZXwmoFYiCTzpk6eQGcsj4Hnsg?table=tbluNJHoiHttVvse&view=vewfgRMcdy"
let researchDocumentURL = "https://my.feishu.cn/wiki/ExEcwGnW0iar0TkXJNOcQX0Xngf?larkTabName=space"
let figmaResearchURL = "https://www.figma.com/design/3JZakdtXSbXFgRdUfZ8ypV/%E7%AB%9E%E5%93%81%E8%B0%83%E7%A0%94%E5%B7%A5%E5%85%B7%E6%B2%89%E6%B7%80?node-id=4-2"

struct TaskRequest: Codable { let competitor: String; let url: String; let userTask: String; let module: String }
struct CaptureStatus: Codable {
    let activeTask: ActiveTask?; let latestCapture: LatestCapture?
    struct ActiveTask: Codable { let competitor: String; let running: Bool?; let status: String?; let launchError: String? }
    struct LatestCapture: Codable { let id: String; let session: String; let name: String; let syncStatus: String }
}
struct CapturePreview: Codable, Identifiable { let id: String; let name: String; let module: String; let syncStatus: String; let imageUrl: String; let observation: String?; let analysis: String?; let toVerify: String?; let uxState: String?; let finalUrl: String? }
struct RecentTask: Codable, Identifiable {
    let taskId: String; let competitor: String; let startUrl: String; let userTask: String; let module: String; let createdAt: String
    var id: String { taskId }
}

enum WorkbenchStage { case landing, details, capturing, review, complete, recents }

@MainActor
final class WorkbenchModel: ObservableObject {
    @Published var competitor = ""
    @Published var pageURL = ""
    @Published var userTask = ""
    @Published var module = ""
    @Published var stage: WorkbenchStage = .details
    @Published var errorText = ""
    @Published var starting = false
    @Published var statusText = ""
    @Published var captures: [CapturePreview] = []
    @Published var isPinned = true
    @Published var activeSession = ""
    @Published var recentTasks: [RecentTask] = []
    @Published var selectedCapture: CapturePreview?
    private var handledSyncedCaptureID = ""
    var closeWindow: (() -> Void)?
    var minimizeWindow: (() -> Void)?
    var zoomWindow: (() -> Void)?
    var setPinned: ((Bool) -> Void)?

    var step: Int { (stage == .review || stage == .complete) ? 3 : stage == .capturing ? 2 : 1 }

    func continueToDetails() {
        guard !competitor.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { errorText = "请先填写竞品名称。"; return }
        errorText = ""
        withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) { stage = .details }
    }

    func launchTask() {
        errorText = ""
        guard !competitor.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !pageURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { errorText = "请补充竞品名称和起始页面网址。"; return }
        guard URL(string: pageURL)?.scheme != nil else { errorText = "请输入完整网址，例如 https://example.com。"; return }
        starting = true
        Task { [weak self] in
            guard let self else { return }
            let serviceReady = await self.isServiceAvailable()
            if !serviceReady {
                self.startLocalService()
                try? await Task.sleep(for: .seconds(1.3))
            }
            await self.submitTask(retries: serviceReady ? 0 : 2)
        }
    }

    private func startLocalService() {
        let launcher = URL(fileURLWithPath: toolDirectory).appendingPathComponent("启动AI竞调采集器.command").path
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/open"); process.arguments = ["-g", "-a", "Terminal", launcher]; try? process.run()
    }

    private func isServiceAvailable() async -> Bool {
        guard let endpoint = URL(string: "http://127.0.0.1:48923/api/status") else { return false }
        guard let (_, response) = try? await URLSession.shared.data(from: endpoint) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    private func submitTask(retries: Int) async {
        guard let endpoint = URL(string: "http://127.0.0.1:48923/api/tasks") else { return }
        var request = URLRequest(url: endpoint); request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(TaskRequest(competitor: competitor, url: pageURL, userTask: userTask, module: module))
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode < 300 else {
                let message = (try? JSONSerialization.jsonObject(with: data) as? [String: String])?["error"] ?? "无法启动采集。"
                throw NSError(domain: "Workbench", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
            }
            starting = false; activeSession = competitor; statusText = "浏览器已打开。在竞品网页右下角使用「截图入库」。"
            withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) { stage = .capturing }
        } catch {
            if retries > 0 { try? await Task.sleep(for: .seconds(1)); await submitTask(retries: retries - 1) }
            else { starting = false; errorText = "暂时无法启动采集服务，请再次点击打开采集浏览器。" }
        }
    }

    func refreshStatus() {
        let session = activeSession.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? activeSession
        guard (stage == .capturing || stage == .review), let endpoint = URL(string: "http://127.0.0.1:48923/api/status"), let captureEndpoint = URL(string: "http://127.0.0.1:48923/api/captures?session=\(session)") else { return }
        Task { [weak self] in
            guard let self, let (statusData, _) = try? await URLSession.shared.data(from: endpoint), let status = try? JSONDecoder().decode(CaptureStatus.self, from: statusData) else { return }
            if status.activeTask?.status == "打开失败", stage == .capturing {
                errorText = status.activeTask?.launchError ?? "无法打开该页面，请检查网址后重试。"
                stage = .details
                return
            }
            if let (captureData, _) = try? await URLSession.shared.data(from: captureEndpoint), let nextCaptures = try? JSONDecoder().decode([CapturePreview].self, from: captureData) {
                if nextCaptures.map(\.id) != captures.map(\.id) {
                    captures = nextCaptures
                }
                if !nextCaptures.isEmpty {
                    statusText = "已收录 \(captures.count) 张截图，可删除本地素材或继续采集。"
                }
            }
            if let latest = status.latestCapture, latest.session == activeSession, latest.syncStatus == "已同步飞书", handledSyncedCaptureID != latest.id {
                handledSyncedCaptureID = latest.id
                statusText = "截图已成功同步到飞书，即将继续采集下一张。"
                withAnimation(.spring(response: 0.36, dampingFraction: 0.88)) { self.stage = .complete }
                Task { [weak self] in
                    try? await Task.sleep(for: .seconds(2.2))
                    guard let self, self.stage == .complete else { return }
                    self.statusText = "已同步上一张截图，可继续在浏览器中采集下一张。"
                    withAnimation(.spring(response: 0.36, dampingFraction: 0.88)) { self.stage = .capturing }
                }
            }
        }
    }

    func restoreCurrentTask() {
        guard let endpoint = URL(string: "http://127.0.0.1:48923/api/status") else { return }
        Task { [weak self] in
            guard let self, let (data, _) = try? await URLSession.shared.data(from: endpoint), let status = try? JSONDecoder().decode(CaptureStatus.self, from: data), let task = status.activeTask, task.running == true else { return }
            competitor = task.competitor
            activeSession = task.competitor
            stage = .capturing
            let session = task.competitor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? task.competitor
            guard let captureEndpoint = URL(string: "http://127.0.0.1:48923/api/captures?session=\(session)"), let (captureData, _) = try? await URLSession.shared.data(from: captureEndpoint), let nextCaptures = try? JSONDecoder().decode([CapturePreview].self, from: captureData) else { return }
            captures = nextCaptures
            if !captures.isEmpty { stage = .review; statusText = "已收录 \(captures.count) 张截图。" }
        }
    }

    func goToStep(_ index: Int) {
        withAnimation(.spring(response: 0.34, dampingFraction: 0.88)) {
            if index == 1 { stage = .details }
            else if index == 2 { stage = .capturing }
            else if index == 3, !captures.isEmpty { stage = .review }
            else if index == 3 { statusText = "暂未收录截图，请先在浏览器中完成截图。"; stage = .capturing }
        }
    }

    func deleteCapture(_ capture: CapturePreview) {
        let session = activeSession.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? activeSession
        guard let endpoint = URL(string: "http://127.0.0.1:48923/api/captures?id=\(capture.id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? capture.id)&session=\(session)") else { return }
        Task { [weak self] in
            var request = URLRequest(url: endpoint); request.httpMethod = "DELETE"
            guard let self, let (data, response) = try? await URLSession.shared.data(for: request), ((response as? HTTPURLResponse)?.statusCode ?? 500) < 300 else { return }
            captures.removeAll { $0.id == capture.id }
            if captures.isEmpty { statusText = "暂无已截图内容，继续在浏览器中采集。"; stage = .capturing }
            _ = data
        }
    }

    func togglePin() { isPinned.toggle(); setPinned?(isPinned) }

    func openRecentTasks() {
        errorText = ""; statusText = ""; stage = .recents
        guard let endpoint = URL(string: "http://127.0.0.1:48923/api/tasks") else { return }
        Task { [weak self] in
            guard let self, let (data, response) = try? await URLSession.shared.data(from: endpoint), (response as? HTTPURLResponse)?.statusCode == 200 else { self?.errorText = "最近任务暂时无法加载。"; return }
            recentTasks = (try? JSONDecoder().decode([RecentTask].self, from: data)) ?? []
        }
    }
    func openTaskURL(_ task: RecentTask) { if let url = URL(string: task.startUrl) { NSWorkspace.shared.open(url) } }
    func returnToWorkbench() { stage = activeSession.isEmpty ? .details : .capturing }
    func openMaterialLibrary() { if let url = URL(string: materialLibraryURL) { NSWorkspace.shared.open(url) } }
    func openResearchDocument() { if let url = URL(string: researchDocumentURL) { NSWorkspace.shared.open(url) } }
    func openFigmaResearchBoard() { if let url = URL(string: figmaResearchURL) { NSWorkspace.shared.open(url) } }
    func reset() { competitor = ""; pageURL = ""; userTask = ""; module = ""; errorText = ""; statusText = ""; captures = []; activeSession = ""; handledSyncedCaptureID = ""; withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) { stage = .details } }
}

struct FloatingCard: View {
    @ObservedObject var model: WorkbenchModel
    private let timer = Timer.publish(every: 3, on: .main, in: .common).autoconnect()
    // Figma 的 36px 在当前 2x Retina 屏上对应 18pt，避免被渲染成约 72px。
    private let interfaceCorner: CGFloat = 18

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                operationSurface(availableWidth: geometry.size.width)
                mirrorControls(compact: geometry.size.width < 420)
                    .padding(.leading, geometry.size.width < 420 ? 14 : 26)
                    .padding(.top, geometry.size.height < 580 ? 14 : 24)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: interfaceCorner, style: .continuous))
        .onReceive(timer) { _ in model.refreshStatus() }
        .onAppear { model.restoreCurrentTask() }
        .sheet(item: $model.selectedCapture) { capture in CaptureDetailSheet(capture: capture) }
    }

    private func operationSurface(availableWidth: CGFloat) -> some View {
        ZStack {
            Image(nsImage: backgroundImage()).resizable().scaledToFill().clipped()
            Color(red: 0.01, green: 0.15, blue: 0.42).opacity(0.22)
            VStack(spacing: 0) {
                navigation(compact: availableWidth < 430)
                if model.stage == .landing { landing(availableWidth: availableWidth) } else { journey(availableWidth: availableWidth) }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: interfaceCorner, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: interfaceCorner, style: .continuous).stroke(.white.opacity(0.24), lineWidth: 1))
    }

    private func mirrorControls(compact: Bool) -> some View {
        HStack(spacing: compact ? 7 : 11) {
            MirrorControl(color: Color(red: 1, green: 0.30, blue: 0.34), help: "收起窗口", action: { model.closeWindow?() })
            MirrorControl(color: Color(red: 1, green: 0.76, blue: 0.08), help: "最小化窗口", action: { model.minimizeWindow?() })
            MirrorControl(color: Color(red: 0.16, green: 0.78, blue: 0.38), help: "新建调研任务", action: model.reset)
            if !compact { Divider().frame(height: 16).overlay(.white.opacity(0.25)) }
            Button(action: model.togglePin) { Image(systemName: model.isPinned ? "pin.fill" : "pin").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(model.isPinned ? 0.96 : 0.58)).frame(width: 23, height: 20).background(.black.opacity(0.16), in: Capsule()) }
                .buttonStyle(.plain).help(model.isPinned ? "取消页面置顶" : "页面置顶")
        }
    }

    private func navigation(compact: Bool) -> some View {
        HStack(spacing: compact ? 10 : 18) {
            Spacer()
            Button("最近任务", action: model.openRecentTasks).buttonStyle(TopLinkStyle())
            Button("素材库", action: model.openMaterialLibrary).buttonStyle(TopLinkStyle())
        }
        .padding(.top, compact ? 13 : 18)
        .padding(.trailing, compact ? 14 : 26)
    }

    private func landing(availableWidth: CGFloat) -> some View {
        let cardWidth = max(300, min(430, availableWidth - 40))
        return VStack(spacing: 0) {
            Spacer().frame(height: 42)
            heroTitle(compact: availableWidth < 430)
            Spacer().frame(height: 42)
            glassPanel {
                VStack(spacing: 0) {
                    progressBar(compact: availableWidth < 430)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("竞品名称").font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(0.92))
                        TextField("例如：小云雀", text: $model.competitor).textFieldStyle(HeroInputStyle()).accessibilityLabel("竞品名称")
                        if !model.errorText.isEmpty { Text(model.errorText).font(.system(size: 11)).foregroundStyle(Color(red: 1, green: 0.76, blue: 0.73)) }
                    }.padding(.horizontal, 30).padding(.top, 45)
                    Spacer()
                    Button(action: model.continueToDetails) { Text("开始采集").frame(width: 184) }.buttonStyle(HeroButtonStyle()).padding(.bottom, 42)
                }
            }.frame(width: cardWidth).frame(minHeight: 430, maxHeight: 470)
            Spacer(minLength: 22)
        }
    }

    private func journey(availableWidth: CGFloat) -> some View {
        let compact = availableWidth < 430
        let cardWidth = max(300, min(430, availableWidth - 40))
        return VStack(spacing: 0) {
            Spacer().frame(height: compact ? 18 : 26)
            heroTitle(compact: compact)
            Spacer().frame(height: compact ? 20 : 30)
            glassPanel {
                VStack(spacing: 0) {
                    progressBar(compact: compact)
                    if model.stage == .recents { recentTasksState }
                    else if model.stage == .details { detailsForm }
                    else if model.stage == .capturing { capturingState }
                    else if model.stage == .review { reviewState }
                    else { completedState }
                }
            }.frame(width: cardWidth).frame(minHeight: 455, maxHeight: 505)
            Spacer(minLength: 18)
        }
    }

    private func heroTitle(compact: Bool) -> some View {
        VStack(spacing: 10) {
            Text("开启竞品调研").font(.system(size: compact ? 24 : 30, weight: .bold, design: .rounded)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.72)
            Text("先定义本轮想确认的问题；不同竞品的路径由你在浏览器中自由走查").font(.system(size: compact ? 11 : 13)).foregroundStyle(.white.opacity(0.86)).lineLimit(compact ? 2 : 1)
        }.multilineTextAlignment(.center).padding(.horizontal, compact ? 16 : 24)
    }

    private func glassPanel<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 36, style: .continuous)
                .fill(LinearGradient(colors: [Color(red: 0.08, green: 0.30, blue: 0.58).opacity(0.84), Color(red: 0.03, green: 0.19, blue: 0.45).opacity(0.77)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(RoundedRectangle(cornerRadius: 36, style: .continuous).stroke(.white.opacity(0.36), lineWidth: 1))
                .shadow(color: .black.opacity(0.24), radius: 24, y: 14)
            content().padding(15)
        }
    }

    private func progressBar(compact: Bool) -> some View {
        HStack(spacing: 9) {
            wideStep(1, compact ? "目标" : "竞品目标", active: model.step == 1, done: model.step > 1, compact: compact)
            progressLine
            wideStep(2, compact ? "收录" : "网页收录", active: model.step == 2, done: model.step > 2, compact: compact)
            progressLine
            wideStep(3, compact ? "沉淀" : "截图沉淀", active: model.step == 3, done: false, compact: compact)
        }
        .padding(.horizontal, compact ? 10 : 16).padding(.vertical, compact ? 12 : 15).background(.white.opacity(0.19), in: Capsule())
    }

    private var progressLine: some View { Rectangle().fill(.white.opacity(0.60)).frame(width: 14, height: 1).overlay { Rectangle().stroke(style: StrokeStyle(lineWidth: 1, dash: [2, 3])).foregroundStyle(.white.opacity(0.55)) } }
    private func wideStep(_ index: Int, _ title: String, active: Bool, done: Bool, compact: Bool) -> some View {
        Button(action: { model.goToStep(index) }) { HStack(spacing: compact ? 3 : 5) { Text(done ? "✓" : String(format: "%02d", index)).font(.system(size: compact ? 10 : 12, weight: .bold, design: .rounded)); Text(title).font(.system(size: compact ? 10 : 12, weight: active ? .semibold : .regular)) }.foregroundStyle(active || done ? .white : .white.opacity(0.56)).fixedSize() }
            .buttonStyle(.plain).contentShape(Rectangle()).help(index == 1 ? "查看调研信息" : index == 2 ? "查看网页收录说明" : "查看已截图素材")
    }

    private var detailsForm: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 15) {
                HStack { VStack(alignment: .leading, spacing: 3) { Text("步骤 1 / 3").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.70)); Text("这次要研究什么？").font(.system(size: 20, weight: .semibold)).foregroundStyle(.white) }; Spacer(); Text("* 必填").font(.system(size: 11)).foregroundStyle(.white.opacity(0.58)) }
                formField("竞品名称 *", text: $model.competitor, placeholder: "例如：小云雀")
                formField("起始页面网址 *", text: $model.pageURL, placeholder: "https://…")
                formTextField("调研目标 / 用户任务（可选）", text: $model.userTask, placeholder: "例如：确认剧本设定的编辑方式与 AI 辅助能力")
                DisclosureGroup("补充模块或路径（可选）") { formField("模块 / 路径", text: $model.module, placeholder: "例如：剧本—故事设定") }.font(.system(size: 11)).foregroundStyle(.white.opacity(0.72))
                if !model.errorText.isEmpty { Text(model.errorText).font(.system(size: 11)).foregroundStyle(Color(red: 1, green: 0.76, blue: 0.73)) }
                Button(action: model.launchTask) { Text(model.starting ? "正在打开…" : "打开采集浏览器").frame(maxWidth: .infinity) }.buttonStyle(HeroButtonStyle()).disabled(model.starting).padding(.top, 3)
            }.padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 18)
        }
    }

    private var recentTasksState: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { VStack(alignment: .leading, spacing: 3) { Text("最近任务").font(.system(size: 20, weight: .semibold)).foregroundStyle(.white); Text("保留最近 15 天的采集入口；点击链接可重新打开对应网站。") .font(.system(size: 10)).foregroundStyle(.white.opacity(0.66)) }; Spacer(); Button("返回", action: model.returnToWorkbench).buttonStyle(SecondaryActionStyle()) }
            if model.recentTasks.isEmpty {
                Spacer(); Text("最近 15 天暂无任务").font(.system(size: 14, weight: .medium)).foregroundStyle(.white.opacity(0.82)); Text("从“竞品目标”填写网址，即可开始新的采集。") .font(.system(size: 11)).foregroundStyle(.white.opacity(0.58)); Spacer()
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 8) {
                        ForEach(model.recentTasks) { task in
                            VStack(alignment: .leading, spacing: 5) {
                                HStack { Text(task.competitor).font(.system(size: 13, weight: .semibold)); Spacer(); Text(task.createdAt.replacingOccurrences(of: "T", with: " ").prefix(16)).font(.system(size: 9)).foregroundStyle(.white.opacity(0.56)) }
                                Text(task.userTask.isEmpty ? "自由走查并沉淀关键截图" : task.userTask).font(.system(size: 10)).foregroundStyle(.white.opacity(0.76)).lineLimit(2)
                                if !task.module.isEmpty { Text(task.module).font(.system(size: 9)).foregroundStyle(.white.opacity(0.56)) }
                                Button("打开原始网页", action: { model.openTaskURL(task) }).buttonStyle(SecondaryActionStyle())
                            }
                            .padding(11).frame(maxWidth: .infinity, alignment: .leading)
                            .background(.black.opacity(0.13), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(.white.opacity(0.18), lineWidth: 1))
                        }
                    }
                }
            }
            if !model.errorText.isEmpty { Text(model.errorText).font(.system(size: 10)).foregroundStyle(Color(red: 1, green: 0.76, blue: 0.73)) }
        }.padding(.horizontal, 18).padding(.top, 20).padding(.bottom, 16)
    }

    private var capturingState: some View {
        VStack(spacing: 16) { Spacer(); Image(systemName: "safari").font(.system(size: 34, weight: .light)).foregroundStyle(.white.opacity(0.92)); Text("正在网页收录").font(.system(size: 20, weight: .semibold)).foregroundStyle(.white); Text("在竞品页面点击右下角「截图入库」。截图成功后仍停留在这里；需要查看、删除或结束记录时，点击步骤 03「截图沉淀」。").multilineTextAlignment(.center).font(.system(size: 12)).lineSpacing(4).foregroundStyle(.white.opacity(0.76)).padding(.horizontal, 34); Spacer(); Text(model.statusText).font(.system(size: 10)).foregroundStyle(.white.opacity(0.55)).padding(.bottom, 20) }.padding(.horizontal, 16)
    }

    private var reviewState: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { VStack(alignment: .leading, spacing: 2) { Text("正在截图沉淀").font(.system(size: 18, weight: .semibold)).foregroundStyle(.white); Text("已收录 \(model.captures.count) 张 · 可继续在浏览器中采集").font(.system(size: 10)).foregroundStyle(.white.opacity(0.64)) }; Spacer(); Text("步骤 03").font(.system(size: 10, weight: .semibold)).foregroundStyle(.white.opacity(0.72)) }
            ScrollView(showsIndicators: false) {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 10) {
                    ForEach(model.captures) { capture in CaptureTile(capture: capture, onOpen: { model.selectedCapture = capture }, onDelete: { model.deleteCapture(capture) }) }
                }
            }
            Text(model.statusText).font(.system(size: 10)).foregroundStyle(.white.opacity(0.60)).lineLimit(1)
            HStack(spacing: 8) {
                Button("飞书资产", action: model.openMaterialLibrary).buttonStyle(SecondaryActionStyle())
                Button("Figma 沉淀", action: model.openFigmaResearchBoard).buttonStyle(SecondaryActionStyle())
                Button("结束记录", action: model.openResearchDocument).buttonStyle(ReviewPrimaryActionStyle())
            }
        }.padding(.horizontal, 18).padding(.top, 20).padding(.bottom, 16)
    }

    private var completedState: some View {
        VStack(spacing: 16) { Spacer(); Image(systemName: "checkmark.circle.fill").font(.system(size: 38)).foregroundStyle(Color(red: 0.70, green: 0.92, blue: 0.78)); Text("截图已沉淀").font(.system(size: 21, weight: .semibold)).foregroundStyle(.white); Text("关键截图与说明已进入飞书素材库。可以继续采集，或开启下一轮调研。").multilineTextAlignment(.center).font(.system(size: 12)).lineSpacing(4).foregroundStyle(.white.opacity(0.76)).padding(.horizontal, 32); Button("开启下一轮", action: model.reset).buttonStyle(HeroButtonStyle()); Spacer() }.padding(.horizontal, 16)
    }

    private func formField(_ label: String, text: Binding<String>, placeholder: String) -> some View { VStack(alignment: .leading, spacing: 6) { Text(label).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.88)); TextField(placeholder, text: text).textFieldStyle(HeroInputStyle()).accessibilityLabel(label) } }
    private func formTextField(_ label: String, text: Binding<String>, placeholder: String) -> some View { VStack(alignment: .leading, spacing: 6) { Text(label).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.88)); TextField(placeholder, text: text, axis: .vertical).lineLimit(2...3).textFieldStyle(HeroInputStyle()).accessibilityLabel(label) } }
    private func backgroundImage() -> NSImage { Bundle.main.image(forResource: "dandelion") ?? NSImage(size: NSSize(width: 1, height: 1)) }
}

struct HeroInputStyle: TextFieldStyle { func _body(configuration: TextField<Self._Label>) -> some View { configuration.textFieldStyle(.plain).font(.system(size: 14, weight: .medium)).foregroundStyle(.white).padding(.horizontal, 15).padding(.vertical, 13).background(Color(red: 0.11, green: 0.27, blue: 0.48).opacity(0.42)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(.white.opacity(0.30), lineWidth: 1)) } }
struct HeroButtonStyle: ButtonStyle { func makeBody(configuration: Configuration) -> some View { HeroButtonBody(configuration: configuration) } }
private struct HeroButtonBody: View {
    let configuration: ButtonStyle.Configuration
    @State private var hovering = false
    var body: some View {
        configuration.label.font(.system(size: 15, weight: .bold)).foregroundStyle(.white).padding(.vertical, 12).padding(.horizontal, 24)
            .background(LinearGradient(colors: [Color(red: 0.49, green: 0.30, blue: 1), Color(red: 0.05, green: 0.32, blue: 1), Color(red: 0.52, green: 0.73, blue: 1)], startPoint: .leading, endPoint: .trailing))
            .clipShape(Capsule()).shadow(color: Color(red: 0.22, green: 0.32, blue: 0.96).opacity(hovering ? 0.62 : 0.42), radius: hovering ? 20 : 14, y: hovering ? 8 : 6)
            .scaleEffect(configuration.isPressed ? 0.98 : (hovering ? 1.025 : 1)).brightness(hovering ? 0.06 : 0).opacity(configuration.isPressed ? 0.84 : 1)
            .onHover { hovering = $0 }.animation(.easeOut(duration: 0.16), value: hovering)
    }
}
struct TopLinkStyle: ButtonStyle { func makeBody(configuration: Configuration) -> some View { TopLinkBody(configuration: configuration) } }
struct SecondaryActionStyle: ButtonStyle { func makeBody(configuration: Configuration) -> some View { configuration.label.font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.88)).padding(.vertical, 9).padding(.horizontal, 11).background(.white.opacity(configuration.isPressed ? 0.10 : 0.16), in: Capsule()).overlay(Capsule().stroke(.white.opacity(0.28), lineWidth: 1)) } }
struct ReviewPrimaryActionStyle: ButtonStyle { func makeBody(configuration: Configuration) -> some View { configuration.label.font(.system(size: 11, weight: .semibold)).foregroundStyle(.white).padding(.vertical, 9).padding(.horizontal, 13).background(LinearGradient(colors: [Color(red: 0.49, green: 0.30, blue: 1), Color(red: 0.05, green: 0.32, blue: 1), Color(red: 0.52, green: 0.73, blue: 1)], startPoint: .leading, endPoint: .trailing), in: Capsule()) } }
private struct TopLinkBody: View {
    let configuration: ButtonStyle.Configuration
    @State private var hovering = false
    var body: some View { configuration.label.font(.system(size: 12, weight: hovering ? .semibold : .regular)).foregroundStyle(.white.opacity(configuration.isPressed ? 0.5 : (hovering ? 1 : 0.9))).padding(.vertical, 5).overlay(alignment: .bottom) { Capsule().fill(.white.opacity(hovering ? 0.72 : 0)).frame(height: 1) }.onHover { hovering = $0 }.animation(.easeOut(duration: 0.15), value: hovering) }
}
private struct MirrorControl: View {
    let color: Color; let help: String; let action: () -> Void
    @State private var hovering = false
    var body: some View {
        Button(action: action) { Circle().fill(color).frame(width: 14, height: 14).overlay(Circle().stroke(.black.opacity(0.24), lineWidth: 1)) }
            .buttonStyle(.plain).help(help).scaleEffect(hovering ? 1.14 : 1).brightness(hovering ? 0.08 : 0).onHover { hovering = $0 }.animation(.easeOut(duration: 0.14), value: hovering)
    }
}
private struct CaptureTile: View {
    let capture: CapturePreview
    let onOpen: () -> Void
    let onDelete: () -> Void
    @State private var hovering = false
    var body: some View {
        ZStack(alignment: .topTrailing) {
            Button(action: onOpen) { VStack(alignment: .leading, spacing: 5) {
                AsyncImage(url: URL(string: "http://127.0.0.1:48923\(capture.imageUrl)")) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                    else { RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.white.opacity(0.14)).overlay(ProgressView().controlSize(.small)) }
                }
                .frame(height: 72).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                HStack(spacing: 4) { Text(capture.id).font(.system(size: 9, weight: .bold)); Text(capture.name).lineLimit(1) }.font(.system(size: 9)).foregroundStyle(.white.opacity(0.84))
                Text(capture.syncStatus).font(.system(size: 8)).foregroundStyle(capture.syncStatus == "已同步" ? Color(red: 0.68, green: 0.92, blue: 0.76) : .white.opacity(0.55))
            } }.buttonStyle(.plain).accessibilityLabel("查看截图 \(capture.id) \(capture.name) 的记录")
            Button(action: onDelete) { Image(systemName: "xmark").font(.system(size: 8, weight: .bold)).foregroundStyle(.white).frame(width: 19, height: 19).background(.black.opacity(0.56), in: Circle()) }
                .buttonStyle(.plain).opacity(hovering ? 1 : 0.78)
        }
        .padding(5).background(.black.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .onHover { hovering = $0 }
    }
}

private struct CaptureDetailSheet: View {
    let capture: CapturePreview
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack { VStack(alignment: .leading, spacing: 3) { Text("\(capture.id)｜\(capture.name)").font(.system(size: 20, weight: .semibold)); Text(capture.module.isEmpty ? "未填写模块" : capture.module).font(.system(size: 12)).foregroundStyle(.secondary) }; Spacer(); Button("完成", action: { dismiss() }) }
            AsyncImage(url: URL(string: "http://127.0.0.1:48923\(capture.imageUrl)")) { phase in if let image = phase.image { image.resizable().scaledToFit() } else { ProgressView().frame(maxWidth: .infinity, minHeight: 180) } }.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Group { detail("同步状态", capture.syncStatus); detail("观察事实", capture.observation ?? "尚未分析"); detail("分析解读", capture.analysis ?? "尚未分析"); detail("待验证", capture.toVerify ?? "尚未填写"); detail("UX 状态", capture.uxState ?? "未记录") }.font(.system(size: 12))
            if let url = URL(string: capture.finalUrl ?? "") { Link("打开截图来源页面", destination: url).font(.system(size: 12, weight: .semibold)) }
        }.padding(22).frame(minWidth: 430, minHeight: 520)
    }
    private func detail(_ title: String, _ value: String) -> some View { VStack(alignment: .leading, spacing: 3) { Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary); Text(value).fixedSize(horizontal: false, vertical: true) } }
}
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var panel: NSPanel!; private let model = WorkbenchModel(); private var statusItem: NSStatusItem!
    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: 64)
        statusItem.autosaveName = "AICompetitorCaptureStatusItem"
        statusItem.button?.title = " 竞调"; statusItem.button?.font = .systemFont(ofSize: 12, weight: .semibold); statusItem.button?.toolTip = "AI 竞调采集器（点此显示或隐藏窗口）"; statusItem.button?.target = self; statusItem.button?.action = #selector(togglePanel); statusItem.button?.imagePosition = .imageLeft; statusItem.button?.imageScaling = .scaleProportionallyDown
        if let iconURL = Bundle.main.url(forResource: "tool-status", withExtension: "png"), let icon = NSImage(contentsOf: iconURL) { icon.size = NSSize(width: 18, height: 18); icon.isTemplate = false; statusItem.button?.image = icon }
        panel = InputPanel(contentRect: NSRect(x: 0, y: 0, width: 520, height: 704), styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
        panel.minSize = NSSize(width: 360, height: 540)
        panel.titleVisibility = .hidden; panel.titlebarAppearsTransparent = true; panel.isOpaque = false; panel.backgroundColor = .clear; panel.appearance = NSAppearance(named: .darkAqua); panel.hasShadow = true; panel.level = .floating; panel.isFloatingPanel = true; panel.hidesOnDeactivate = false; panel.isMovableByWindowBackground = true; panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.becomesKeyOnlyIfNeeded = false
        let container = NSView(frame: panel.contentView?.bounds ?? .zero)
        container.autoresizingMask = [.width, .height]; container.wantsLayer = true; container.layer?.cornerRadius = 18; container.layer?.masksToBounds = true
        let hosting = NSHostingView(rootView: FloatingCard(model: model))
        hosting.frame = container.bounds; hosting.autoresizingMask = [.width, .height]; container.addSubview(hosting)
        panel.contentView = container
        model.closeWindow = { [weak self] in self?.panel.orderOut(nil) }
        model.minimizeWindow = { [weak self] in self?.panel.orderOut(nil) }
        model.zoomWindow = { [weak self] in self?.panel.zoom(nil) }
        model.setPinned = { [weak self] pinned in self?.panel.level = pinned ? .floating : .normal }
        installEditMenu()
        showPanel()
    }
    @objc private func togglePanel() { if panel.isVisible { panel.orderOut(nil) } else { showPanel() } }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showPanel(); return true }
    private func showPanel() { positionPanel(); panel.orderFrontRegardless(); panel.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    private func positionPanel() { guard let screen = NSScreen.main else { return }; let frame = screen.visibleFrame; panel.setFrameOrigin(NSPoint(x: frame.maxX - panel.frame.width - 28, y: frame.maxY - panel.frame.height - 32)) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    private func installEditMenu() {
        let mainMenu = NSMenu()
        let editItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(NSMenuItem(title: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(NSMenuItem(title: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)
        NSApp.mainMenu = mainMenu
    }
}

final class InputPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

@main @MainActor struct FloatingWorkbenchApplication { static func main() { let application = NSApplication.shared; let delegate = AppDelegate(); application.delegate = delegate; application.setActivationPolicy(.accessory); application.run() } }
