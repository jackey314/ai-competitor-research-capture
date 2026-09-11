const $ = (selector) => document.querySelector(selector);
const form = $('#task-form'); const error = $('#form-error'); const statusCard = $('#status-card'); const taskList = $('#task-list');
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]));
function setSteps(current) { document.querySelectorAll('.step').forEach((step) => { const level = Number(step.dataset.step); step.classList.toggle('active', level === current); step.classList.toggle('done', level < current); }); }
function setStatus(title, detail, state = 'idle') { statusCard.dataset.state = state; statusCard.innerHTML = `<span class="status-dot" aria-hidden="true"></span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`; }
async function refresh() {
  try {
    const [tasks, status] = await Promise.all([fetch('/api/tasks').then((r) => r.json()), fetch('/api/status').then((r) => r.json())]);
    taskList.innerHTML = tasks.length ? tasks.slice(0, 3).map((task) => `<article class="task"><div><strong>${escapeHtml(task.competitor)}</strong><span>${escapeHtml(task.userTask)}</span></div><span class="tag">${escapeHtml(task.status || '进行中')}</span></article>`).join('') : '<p class="empty">还没有任务。</p>';
    if (status.activeTask?.running) { setSteps(2); setStatus('采集浏览器已打开', `正在走查 ${status.activeTask.competitor}。完成后关闭采集窗口即可。`, 'active'); }
    else if (status.latestCapture?.syncStatus === '已同步飞书') { setSteps(3); setStatus('最新截图已同步飞书', `${status.latestCapture.session} · ${status.latestCapture.name}`, 'synced'); }
    else { setSteps(1); setStatus('准备就绪', '创建任务后，浏览器会自动打开。'); }
  } catch { setSteps(1); setStatus('工作台暂不可用', '请关闭后重新打开 AI竞调采集器。'); }
}
form.addEventListener('submit', async (event) => { event.preventDefault(); error.textContent = ''; const data = Object.fromEntries(new FormData(form)); const button = form.querySelector('button'); button.disabled = true; button.querySelector('span').textContent = '正在打开采集浏览器…'; try { const response = await fetch('/api/tasks', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); form.reset(); setSteps(2); setStatus('采集浏览器已打开', `任务 ${result.taskId} 已创建，请切换到浏览器继续。`, 'active'); await refresh(); } catch (err) { error.textContent = err.message || '无法启动任务，请检查填写内容。'; } finally { button.disabled = false; button.querySelector('span').textContent = '开始采集'; } });
if (location.protocol === 'file:') { setSteps(1); setStatus('这是界面预览', '双击 AI竞调采集器.app 后可启动采集与飞书同步。'); }
else { refresh(); setInterval(refresh, 4000); }
