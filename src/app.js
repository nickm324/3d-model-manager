import { EditorView, basicSetup } from 'codemirror';
import { StreamLanguage } from '@codemirror/language';
import { clike } from '@codemirror/legacy-modes/mode/clike';
import { ModelViewer } from './viewer.js';
import { parseParameters, parameterChange } from './customizer.js';
import { matchesModelSearch } from './search.js';

const $ = id => document.getElementById(id);
const state = { files: [], folders: [], projects: [], collapsedFolders: new Set(), knownBranchFolders: new Set(), selectedPaths: new Set(), selected: null, mode: 'all', folder: '', collection: '', projectId: '', limit: 60, dirty: false, metaDirty: false, settingsDirty: false, source: '', revision: '', selectionToken: 0, renderToken: 0, writable: false, config: null, scanPoll: null };
let viewer, editor, toastTimer;
let customizerTimer, autoRenderTimer, dependencyTimer, customizerUpdating = false;
const sidebarResizer = $('sidebar-resizer');
const libraryPane = document.querySelector('.library-pane'), libraryResizer = document.createElement('div'); libraryResizer.id = 'library-resizer'; libraryResizer.tabIndex = 0; libraryResizer.setAttribute('role', 'separator'); libraryResizer.setAttribute('aria-label', 'Resize model list'); libraryResizer.setAttribute('aria-orientation', 'vertical'); libraryPane.after(libraryResizer);
function applyLibraryWidth(width) { const workspace = document.querySelector('.workspace'); let saved = width; if (saved == null) try { saved = Number(localStorage.getItem('model-list-width')); } catch {} const available = workspace.clientWidth || 1300, value = Math.max(300, Math.min(Number(saved) || 390, Math.min(700, available - 620))); workspace.style.setProperty('--library-width', `${value}px`); libraryResizer.setAttribute('aria-valuenow', String(Math.round(value))); if (width != null) try { localStorage.setItem('model-list-width', String(Math.round(value))); } catch {} }
applyLibraryWidth();
libraryResizer.addEventListener('pointerdown', event => { if (matchMedia('(max-width:900px)').matches) return; event.preventDefault(); libraryResizer.setPointerCapture(event.pointerId); document.body.classList.add('resizing-library'); const move = moveEvent => applyLibraryWidth(moveEvent.clientX - libraryPane.getBoundingClientRect().left); const finish = finishEvent => { move(finishEvent); libraryResizer.releasePointerCapture(event.pointerId); libraryResizer.removeEventListener('pointermove', move); libraryResizer.removeEventListener('pointerup', finish); libraryResizer.removeEventListener('pointercancel', finish); document.body.classList.remove('resizing-library'); }; libraryResizer.addEventListener('pointermove', move); libraryResizer.addEventListener('pointerup', finish); libraryResizer.addEventListener('pointercancel', finish); });
libraryResizer.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const current = parseFloat(getComputedStyle(document.querySelector('.workspace')).getPropertyValue('--library-width')) || 390; applyLibraryWidth(current + (event.key === 'ArrowRight' ? 24 : -24)); });
function applySidebarWidth(width) {
  const workspace = document.querySelector('.workspace'); let saved = width;
  if (saved == null) try { saved = Number(localStorage.getItem('folder-navigator-width')); } catch {}
  const available = workspace.clientWidth || 1200, value = Math.max(190, Math.min(Number(saved) || 220, Math.min(520, available - 560)));
  workspace.style.setProperty('--sidebar-width', `${value}px`); sidebarResizer.setAttribute('aria-valuenow', String(Math.round(value)));
  if (width != null) try { localStorage.setItem('folder-navigator-width', String(Math.round(value))); } catch {}
}
applySidebarWidth();
sidebarResizer.addEventListener('pointerdown', event => {
  if (matchMedia('(max-width: 900px)').matches) return; event.preventDefault(); sidebarResizer.setPointerCapture(event.pointerId); document.body.classList.add('resizing-sidebar');
  const move = moveEvent => applySidebarWidth(moveEvent.clientX - document.querySelector('.workspace').getBoundingClientRect().left);
  const finish = finishEvent => { move(finishEvent); sidebarResizer.releasePointerCapture(event.pointerId); sidebarResizer.removeEventListener('pointermove', move); sidebarResizer.removeEventListener('pointerup', finish); sidebarResizer.removeEventListener('pointercancel', finish); document.body.classList.remove('resizing-sidebar'); };
  sidebarResizer.addEventListener('pointermove', move); sidebarResizer.addEventListener('pointerup', finish); sidebarResizer.addEventListener('pointercancel', finish);
});
sidebarResizer.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const current = parseFloat(getComputedStyle(document.querySelector('.workspace')).getPropertyValue('--sidebar-width')) || 220; applySidebarWidth(current + (event.key === 'ArrowRight' ? 24 : -24)); });
window.addEventListener('resize', () => { applySidebarWidth(); applyLibraryWidth(); });
const scadPanel = document.createElement('section'); scadPanel.id = 'scad-panel'; scadPanel.hidden = true;
const scadResizer = document.createElement('div'); scadResizer.id = 'scad-resizer'; scadResizer.hidden = true; scadResizer.tabIndex = 0; scadResizer.setAttribute('role', 'separator'); scadResizer.setAttribute('aria-label', 'Resize OpenSCAD panel'); scadResizer.setAttribute('aria-orientation', 'vertical');
const deleteButton = document.createElement('button'); deleteButton.id = 'delete-file'; deleteButton.className = 'danger'; deleteButton.textContent = 'Delete'; $('download').after(deleteButton);
const coverInput = document.createElement('input'); coverInput.id = 'cover-input'; coverInput.type = 'file'; coverInput.accept = 'image/png,image/jpeg,image/webp'; coverInput.hidden = true;
const coverButton = document.createElement('button'); coverButton.id = 'set-cover'; coverButton.textContent = 'Set cover'; coverButton.type = 'button';
const resetCoverButton = document.createElement('button'); resetCoverButton.id = 'reset-cover'; resetCoverButton.textContent = 'Use automatic cover'; resetCoverButton.type = 'button'; resetCoverButton.hidden = true;
const convertButton = document.createElement('button'); convertButton.id = 'convert-3mf'; convertButton.textContent = 'Convert to 3MF'; convertButton.type = 'button'; convertButton.hidden = true;
deleteButton.before(convertButton, coverButton, resetCoverButton, coverInput);
const filterRow = document.querySelector('.filter-row');
const advancedButton = document.createElement('button'); advancedButton.id = 'advanced-toggle'; advancedButton.type = 'button'; advancedButton.textContent = 'Filters'; advancedButton.setAttribute('aria-expanded', 'false');
filterRow.append(advancedButton);
const advancedFilters = document.createElement('section'); advancedFilters.id = 'advanced-filters'; advancedFilters.hidden = true;
advancedFilters.innerHTML = `<div class="saved-search-row"><select id="saved-search" aria-label="Saved search"><option value="">Saved searches…</option></select><button id="save-search" type="button">Save</button><button id="delete-search" type="button" disabled>Delete</button></div><div class="advanced-filter-grid"><label>Collection<select id="filter-collection"><option value="">Any collection</option></select></label><label>Designer<input id="filter-designer" list="designer-options" placeholder="Any designer"><datalist id="designer-options"></datalist></label><label>License<input id="filter-license" list="license-options" placeholder="Any license"><datalist id="license-options"></datalist></label><label>Slicer or application<input id="filter-slicer" list="slicer-options" placeholder="Any slicer"><datalist id="slicer-options"></datalist></label><label>Minimum size (MB)<input id="filter-size-min" type="number" min="0" step="0.1" placeholder="No minimum"></label><label>Maximum size (MB)<input id="filter-size-max" type="number" min="0" step="0.1" placeholder="No maximum"></label><label>Minimum longest side<input id="filter-dimension-min" type="number" min="0" step="0.1" placeholder="3MF units"></label><label>Maximum longest side<input id="filter-dimension-max" type="number" min="0" step="0.1" placeholder="3MF units"></label><label>Modified after<input id="filter-date-after" type="date"></label><label>Modified before<input id="filter-date-before" type="date"></label></div><div class="advanced-filter-actions"><button id="clear-filters" type="button">Clear filters</button></div>`;
filterRow.after(advancedFilters);
const collectionsHeading = $('collections').previousElementSibling, projectsHeading = document.createElement('p'), projectList = document.createElement('div'); projectsHeading.className = 'eyebrow'; projectsHeading.textContent = 'PROJECTS'; projectList.id = 'projects'; collectionsHeading.before(projectsHeading, projectList);
const projectLabel = document.createElement('label'); projectLabel.innerHTML = 'Project<select id="project"><option value="">No project</option></select>';
const roleLabel = document.createElement('label'); roleLabel.innerHTML = 'File role<select id="file-role"><option value="">Unspecified</option><option value="part">Part</option><option value="assembly">Assembly</option><option value="alternate">Alternate version</option><option value="source">Source file</option><option value="export">Generated export</option><option value="support">Supporting file</option></select>';
const sourceLabel = document.createElement('label'); sourceLabel.id = 'source-link-label'; sourceLabel.innerHTML = 'OpenSCAD source<select id="source-link"><option value="">No linked source</option></select>';
$('metadata-form').querySelector('.notes-label').before(projectLabel, roleLabel, sourceLabel);
const relationshipPanel = document.createElement('section'); relationshipPanel.id = 'project-relationship'; relationshipPanel.className = 'project-relationship'; relationshipPanel.hidden = true; document.querySelector('.metadata').before(relationshipPanel);
const printPanel = document.createElement('section'); printPanel.id = 'print-history'; printPanel.className = 'print-history';
printPanel.innerHTML = `<div class="print-history-heading"><div><h3>Print history</h3><span id="print-summary">No prints recorded</span></div><button id="toggle-print-form" type="button">＋ Record a print</button></div><form id="print-form" hidden><div class="print-fields"><label>Date<input id="print-date" type="date" required></label><label>Result<select id="print-result"><option value="success">Successful</option><option value="failed">Failed</option><option value="partial">Partial</option><option value="test">Test print</option></select></label><label>Printer<input id="print-printer" placeholder="e.g. Bambu Lab A1"></label><label>Filament<input id="print-filament" placeholder="e.g. PLA Basic"></label><label>Color<input id="print-color" placeholder="e.g. Black"></label><label>Nozzle (mm)<input id="print-nozzle" type="number" min="0.05" max="5" step="0.05" placeholder="0.4"></label><label>Layer height (mm)<input id="print-layer" type="number" min="0.01" max="5" step="0.01" placeholder="0.20"></label><label>Quantity<input id="print-quantity" type="number" min="1" max="10000" value="1"></label><label class="print-notes">Print notes<textarea id="print-notes" rows="2" placeholder="Settings that worked, failure details, changes for next time…"></textarea></label><label class="print-photo">Finished-print photo <span class="hint">optional</span><input id="print-photo" type="file" accept="image/png,image/jpeg,image/webp"></label></div><div class="print-form-actions"><button id="cancel-print" type="button">Cancel</button><button class="primary" type="submit">Save print</button></div></form><div id="print-records" class="print-records"></div>`;
document.querySelector('.metadata').before(printPanel);
const groupButton = document.createElement('button'); groupButton.id = 'bulk-project'; groupButton.textContent = 'Group as project'; $('bulk-move').before(groupButton);
const bulkDownloadButton = document.createElement('button'); bulkDownloadButton.id = 'bulk-download'; bulkDownloadButton.textContent = 'Download ZIP'; $('bulk-move').before(bulkDownloadButton);
const missingButton = document.createElement('button'); missingButton.id = 'missing-metadata'; missingButton.className = 'nav-item'; missingButton.innerHTML = '◫ <span>Missing details</span><b id="missing-count">0</b>'; $('duplicates').after(missingButton);
const saveRenderButton = document.createElement('button'); saveRenderButton.id = 'save-render'; saveRenderButton.textContent = 'Save STL to library'; saveRenderButton.hidden = true; $('export-stl').after(saveRenderButton);
const compareButton = document.createElement('button'); compareButton.id = 'compare-source'; compareButton.textContent = 'Compare changes'; compareButton.type = 'button'; $('download-source').after(compareButton);
const dependencyPanel = document.createElement('details'); dependencyPanel.id = 'dependency-panel'; dependencyPanel.innerHTML = '<summary>Dependencies</summary><div id="dependency-tree">Open an OpenSCAD file to inspect dependencies.</div>'; $('render-console').after(dependencyPanel);
const compareDialog = document.createElement('dialog'); compareDialog.id = 'compare-dialog'; compareDialog.innerHTML = '<h2>Draft compared with saved source</h2><div id="source-diff"></div><div class="dialog-actions"><button id="close-compare" type="button">Close</button></div>'; document.body.append(compareDialog);
const libraryName = document.createElement('span'); libraryName.id = 'library-name'; document.querySelector('.sidebar-foot div').firstChild.replaceWith(libraryName);
const backupCard = document.createElement('section'); backupCard.className = 'settings-card'; backupCard.innerHTML = `<div class="card-heading"><div><h2>Backup and recovery</h2><p>Export app metadata and settings. Model files remain on their storage share.</p></div></div><div class="settings-fields"><label>Automatic metadata backups<select id="backup-interval"><option value="0">Off</option><option value="24">Daily</option><option value="168">Weekly</option></select></label><label>Backups to retain<input id="backup-retention" type="number" min="1" max="30" value="7"></label></div><label>Optional export password<input id="backup-password" type="password" autocomplete="new-password" placeholder="Leave blank to omit the SMB password"></label><div class="bridge-actions"><button id="export-backup" type="button">Export current backup</button><button id="restore-backup" type="button">Restore backup</button><input id="restore-file" type="file" accept="application/zip,.zip,application/json,.json" hidden></div><div class="backup-list-heading"><strong>Automatic backups</strong><button id="download-all-backups" type="button">Download all</button></div><div id="backup-list" class="backup-list"><span>Loading backups…</span></div><p class="settings-note">Downloaded automatic backups omit the SMB password. Reconnect the share after restoring one on another installation.</p>`;
document.querySelector('.status-card').before(backupCard);
const accessCard = document.createElement('section'); accessCard.className = 'settings-card'; accessCard.innerHTML = `<div class="card-heading"><div><h2>Users and access</h2><p>Optional sign-in for people who can reach this app.</p></div></div><label class="dialog-check"><input id="auth-enabled" type="checkbox"> Require users to sign in</label><div class="settings-fields"><label>Username<input id="auth-username" autocomplete="off"></label><label>Role<select id="auth-role"><option value="admin">Administrator</option><option value="editor">Editor</option><option value="viewer">Read-only</option></select></label><label>Password<input id="auth-password" type="password" autocomplete="new-password" placeholder="At least 8 characters"></label><label>Reverse proxy username header <span class="hint">optional</span><input id="auth-proxy-header" placeholder="Example: Remote-User"></label></div><div class="bridge-actions"><button id="auth-add-user" type="button">Add or update user</button><button id="auth-save" type="button">Save access settings</button></div><div id="auth-users" class="admin-list"></div><p class="settings-note">Only configure a proxy header when the app cannot be reached without passing through that trusted proxy.</p>`;
document.querySelector('.status-card').before(accessCard);
const historyCard = document.createElement('section'); historyCard.className = 'settings-card network-card'; historyCard.innerHTML = `<div class="card-heading"><div><h2>Activity and recycle bin</h2><p>Review recent changes and restore deleted model files.</p></div><button id="refresh-history" type="button">Refresh</button></div><div class="settings-fields"><label>Keep deleted files for<input id="recycle-retention" type="number" min="1" max="365" value="30"></label></div><h3>Recycle bin</h3><div id="recycle-list" class="admin-list recycle-list"><span>Loading…</span></div><h3 class="history-heading">Recent activity</h3><div id="history-list" class="admin-list history-list"><span>Loading…</span></div>`; document.querySelector('.status-card').before(historyCard);
const loginDialog = document.createElement('dialog'); loginDialog.id = 'login-dialog'; loginDialog.innerHTML = `<form id="login-form"><p class="eyebrow">3D MODEL MANAGER</p><h2>Sign in</h2><label>Username<input id="login-username" autocomplete="username" required></label><label>Password<input id="login-password" type="password" autocomplete="current-password" required></label><p id="login-error" role="alert"></p><div class="dialog-actions"><button class="primary" type="submit">Sign in</button></div></form>`; document.body.append(loginDialog);
const setupDialog = document.createElement('dialog'); setupDialog.id = 'setup-dialog'; setupDialog.innerHTML = `<p class="eyebrow">WELCOME</p><h2>Set up your model library</h2><p>3D Model Manager keeps your models on their existing SMB share and stores only its catalog, settings, previews, and backups in the container data folder.</p><ol class="setup-steps"><li>Connect to your NAS and choose a share.</li><li>Select one or more folders to include.</li><li>Let the first scan build your searchable catalog.</li></ol><div class="dialog-actions"><button id="setup-later" type="button">Set up later</button><button id="setup-connect" class="primary" type="button">Connect a NAS</button></div>`; document.body.append(setupDialog);
const accountButton = document.createElement('button'); accountButton.id = 'account-button'; accountButton.hidden = true; document.querySelector('.top-actions').prepend(accountButton);
accessCard.addEventListener('input', event => event.stopPropagation());
const editorHost = $('editor'); editorHost.replaceWith(scadPanel);
scadPanel.before(scadResizer);
scadPanel.innerHTML = '<div class="editor-tabs" role="tablist" aria-label="OpenSCAD editing mode"><button id="customizer-tab" role="tab" aria-selected="true" aria-controls="customizer">Customizer</button><button id="source-tab" role="tab" aria-selected="false" aria-controls="editor" tabindex="-1">Source code</button><span id="parameter-count"></span></div><div id="customizer" role="tabpanel" aria-labelledby="customizer-tab"></div>';
scadPanel.append(editorHost); editorHost.setAttribute('role', 'tabpanel'); editorHost.setAttribute('aria-labelledby', 'source-tab');
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const bytes = value => value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5500); }
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'X-Model-Manager': '1', ...(options.body && !(options.body instanceof File) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!response.ok) { let message; try { message = (await response.json()).error; } catch {} if (response.status === 401 && url !== '/api/auth/login') loginDialog.showModal(); const error = new Error(message || `Request failed (${response.status}).`); error.status = response.status; throw error; }
  return response;
}
async function request(url, method, body) { return (await api(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).json(); }
function action(id, fn) { $(id).addEventListener('click', async event => { try { await fn(event); } catch (e) { toast(e.message); } }); }
function fileUrl(file, download = false) { return `/api/file?path=${encodeURIComponent(file.path)}${download ? '&download=1' : ''}`; }
function draftChanged() { state.dirty = editor && editor.state.doc.toString() !== state.source; $('draft-state').textContent = state.dirty ? 'Unsaved draft' : 'Saved source'; $('save-source').disabled = !state.writable || !state.dirty; if (state.renderedSource !== undefined) $('viewer-label').textContent = editor?.state.doc.toString() === state.renderedSource ? 'RENDERED PREVIEW' : 'PREVIEW NEEDS RENDERING'; if (!customizerUpdating) { clearTimeout(customizerTimer); customizerTimer = setTimeout(drawCustomizer, 200); } clearTimeout(dependencyTimer); dependencyTimer = setTimeout(loadDependencies, 700); }
function autoRenderEnabled() { try { return localStorage.getItem('openscad-auto-render') !== 'false'; } catch { return true; } }
function queueAutoRender() { clearTimeout(autoRenderTimer); if (!autoRenderEnabled()) return; autoRenderTimer = setTimeout(() => { if (state.selected?.type === 'scad' && !$('render').disabled) $('render').click(); }, 900); }
function showEditorMode(mode) {
  state.editorMode = mode; $('customizer').hidden = mode !== 'customizer'; $('editor').hidden = mode !== 'source';
  for (const [id, active] of [['customizer-tab', mode === 'customizer'], ['source-tab', mode === 'source']]) { $(id).setAttribute('aria-selected', String(active)); $(id).tabIndex = active ? 0 : -1; }
  applyScadPanelWidth();
  if (mode === 'customizer') drawCustomizer(); else editor?.requestMeasure();
}
function applyScadPanelWidth(width) {
  const workspace = $('model-workspace'), mode = state.editorMode || 'customizer', fallback = mode === 'source' ? 560 : 340;
  let saved = width;
  if (saved == null) try { saved = Number(localStorage.getItem(`scad-panel-width-${mode}`)); } catch {}
  const available = workspace.clientWidth || 1000, value = Math.max(280, Math.min(Number(saved) || fallback, Math.max(280, available - 300)));
  workspace.style.setProperty('--scad-panel-width', `${value}px`); scadResizer.setAttribute('aria-valuenow', String(Math.round(value)));
  if (width != null) try { localStorage.setItem(`scad-panel-width-${mode}`, String(Math.round(value))); } catch {}
  editor?.requestMeasure();
}
scadResizer.addEventListener('pointerdown', event => {
  if (matchMedia('(max-width: 620px)').matches) return; event.preventDefault(); scadResizer.setPointerCapture(event.pointerId); document.body.classList.add('resizing-scad');
  const move = moveEvent => applyScadPanelWidth($('model-workspace').getBoundingClientRect().right - moveEvent.clientX);
  const finish = finishEvent => { move(finishEvent); scadResizer.releasePointerCapture(event.pointerId); scadResizer.removeEventListener('pointermove', move); scadResizer.removeEventListener('pointerup', finish); scadResizer.removeEventListener('pointercancel', finish); document.body.classList.remove('resizing-scad'); };
  scadResizer.addEventListener('pointermove', move); scadResizer.addEventListener('pointerup', finish); scadResizer.addEventListener('pointercancel', finish);
});
scadResizer.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const current = parseFloat(getComputedStyle($('model-workspace')).getPropertyValue('--scad-panel-width')) || 340; applyScadPanelWidth(current + (event.key === 'ArrowLeft' ? 24 : -24)); });
function drawCustomizer() {
  if (!editor || state.selected?.type !== 'scad') return;
  const parameters = parseParameters(editor.state.doc.toString()); $('parameter-count').textContent = `${parameters.length} settings`;
  if (!parameters.length) { $('customizer').innerHTML = '<div class="customizer-empty"><strong>No adjustable settings found</strong><p>Add simple variables near the top of your source, before the first opening brace.</p><code>width = 30; // [10:1:100]</code><p>Calculated values and hidden variables remain in Source code.</p></div>'; return; }
  const groups = [...new Set(parameters.map(p => p.group))];
  const presets = state.selected.presets || {};
  $('customizer').innerHTML = `<div class="preset-bar"><select id="preset-choice" aria-label="Parameter preset"><option value="">Parameter presets…</option>${Object.keys(presets).sort().map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join('')}</select><button id="save-preset" type="button">Save preset</button><button id="delete-preset" type="button" disabled>Delete</button></div><label class="auto-render"><input id="auto-render" type="checkbox" ${autoRenderEnabled() ? 'checked' : ''}> Automatically render after settings change</label><p class="customizer-help">Changes stay in your draft until saved.</p>` + groups.map(group => `<fieldset class="parameter-group"><legend>${escape(group)}</legend>${parameters.filter(p => p.group === group).map(p => {
    const label = p.name === '$fn' ? 'Curve resolution ($fn)' : p.name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, char => char.toUpperCase());
    const attrs = `data-parameter="${escape(p.name)}"`;
    const numberAttrs = `step="${p.step || 'any'}" ${p.range ? `min="${p.min}" max="${p.max}"` : ''}`;
    let control;
    if (p.options) control = `<select ${attrs} aria-label="${escape(label)}">${p.options.map(option => `<option value="${escape(String(option.value))}" ${option.value === p.value ? 'selected' : ''}>${escape(option.label)}</option>`).join('')}</select>`;
    else if (p.type === 'boolean') control = `<input ${attrs} type="checkbox" ${p.value ? 'checked' : ''} aria-label="${escape(label)}">`;
    else if (p.type === 'vector') control = `<span class="vector-inputs">${p.value.map((value, index) => `<input ${attrs} data-component="${index}" type="number" value="${value}" ${numberAttrs} aria-label="${escape(label)} ${['X', 'Y', 'Z', 'W'][index]}">`).join('')}</span>`;
    else if (p.type === 'number') control = `<span class="number-control">${p.range ? `<input ${attrs} type="range" value="${p.value}" min="${p.min}" max="${p.max}" step="${p.step}" aria-label="${escape(label)} slider">` : ''}<input ${attrs} type="number" value="${p.value}" ${numberAttrs} aria-label="${escape(label)}"></span>`;
    else control = `<input ${attrs} type="text" value="${escape(p.value)}" ${p.maxLength ? `maxlength="${p.maxLength}"` : ''} aria-label="${escape(label)}">`;
    return `<div class="parameter ${p.type === 'boolean' ? 'boolean-parameter' : ''}"><div class="parameter-label" title="${escape(p.name)}">${escape(label)}</div>${control}${p.description ? `<p class="parameter-description">${escape(p.description)}</p>` : ''}</div>`;
  }).join('')}</fieldset>`).join('') + '<button id="reset-parameters" class="reset-parameters" type="button">Reset settings to saved source</button>';
}
function dependencyMarkup(node) { const label = node.reference || node.path, stateText = node.missing ? ' — missing' : node.circular ? ' — already listed' : node.truncated ? ' — limit reached' : ''; return `<li class="${node.missing ? 'missing' : ''}"><span>${node.kind ? `${escape(node.kind)}: ` : ''}${escape(label)}${stateText}</span>${node.children?.length ? `<ul>${node.children.map(dependencyMarkup).join('')}</ul>` : ''}</li>`; }
async function loadDependencies() { if (!editor || state.selected?.type !== 'scad') return; const path = state.selected.path, source = editor.state.doc.toString(); $('dependency-tree').innerHTML = '<p>Checking imports…</p>'; try { const tree = await request('/api/dependencies', 'POST', { path, source }); if (state.selected?.path !== path) return; $('dependency-tree').innerHTML = `<ul class="dependency-tree">${dependencyMarkup(tree)}</ul>`; } catch (error) { $('dependency-tree').textContent = error.message; } }
function sourceDiff(saved, draft) { const before = saved.split('\n'), after = draft.split('\n'); let prefix = 0; while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++; let suffix = 0; while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++; if (prefix === before.length && prefix === after.length) return '<p class="no-changes">The draft matches the saved source.</p>'; const start = Math.max(0, prefix - 3), beforeEnd = Math.min(before.length, before.length - suffix + 3), afterEnd = Math.min(after.length, after.length - suffix + 3), rows = []; for (let index = start; index < prefix; index++) rows.push(`<div class="same"><b>${index + 1}</b><code> ${escape(before[index])}</code></div>`); for (let index = prefix; index < before.length - suffix; index++) rows.push(`<div class="removed"><b>−</b><code>${escape(before[index])}</code></div>`); for (let index = prefix; index < after.length - suffix; index++) rows.push(`<div class="added"><b>+</b><code>${escape(after[index])}</code></div>`); for (let offset = 0; offset < Math.min(3, suffix); offset++) { const index = before.length - suffix + offset; rows.push(`<div class="same"><b>${index + 1}</b><code> ${escape(before[index])}</code></div>`); } return `<div class="source-diff">${rows.join('')}</div>`; }
async function mayLeave() {
  if (state.saving) { toast('Wait for the save to finish.'); return false; }
  if (!state.dirty && !state.metaDirty) return true;
  $('unsaved-dialog').showModal();
  return new Promise(resolve => {
    const finish = answer => { $('unsaved-dialog').close(); $('unsaved-stay').onclick = null; $('unsaved-discard').onclick = null; $('unsaved-dialog').oncancel = null; resolve(answer); };
    $('unsaved-stay').onclick = () => finish(false); $('unsaved-discard').onclick = () => finish(true); $('unsaved-dialog').oncancel = () => finish(false);
  });
}
function saveBlob(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
const bridgeToken = () => { try { return localStorage.getItem('model-manager-bridge-token') || ''; } catch { return ''; } };
async function bridgeRequest(endpoint, body) {
  const response = await fetch(`http://127.0.0.1:3211${endpoint}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': bridgeToken() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Desktop bridge is unavailable.'); return result;
}
async function detectSlicers() {
  const result = await bridgeRequest('/status'); $('bridge-default').innerHTML = result.slicers.length ? result.slicers.map(s => `<option value="${escape(s.path)}" ${s.default ? 'selected' : ''}>${escape(s.name)}</option>`).join('') : '<option value="">No supported slicers detected</option>';
  $('slicer-choice').querySelectorAll('option[data-bridge]').forEach(option => option.remove());
  for (const slicer of result.slicers) { const option = new Option(slicer.name, `bridge:${slicer.path}`); option.dataset.bridge = '1'; $('slicer-choice').add(option); }
  $('bridge-status').textContent = result.slicers.length ? `${result.slicers.length} slicer${result.slicers.length === 1 ? '' : 's'} detected on this computer.` : 'Bridge connected, but no supported slicers were detected.';
  return result;
}
function drawExtractedInfo(file) {
  const host = $('extracted-info'), info = file.modelInfo, project = file.projectInfo, rows = [];
  if (info?.standard) {
    const s = info.standard;
    for (const [label, value] of [['Title', s.title], ['Designer', s.designer], ['Description', s.description], ['Application', s.application], ['License', s.license], ['Units', s.unit], ['Objects', s.objects], ['Components', s.components], ['Build items', s.buildItems], ['Dimensions', s.dimensions?.map(x => Number(x).toFixed(1)).join(' × ')]]) if (value !== '' && value != null) rows.push(`<div class="${label === 'Description' ? 'info-wide' : ''}"><dt>${label}</dt><dd>${escape(value)}</dd></div>`);
  }
  if (info?.bambu) for (const [label, value] of [['Bambu plates', info.bambu.plates], ['Printer profile', info.bambu.printer], ['Filament', info.bambu.filament], ['Process profile', info.bambu.profile], ['Estimated time', info.bambu.estimatedTime]]) if (value !== '' && value != null) rows.push(`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`);
  if (project) for (const [label, value] of [['Project', project.title], ['Description', project.description], ['Printing notes', project.printingNotes], ['Attribution', project.attribution], ['License', project.license]]) if (value) rows.push(`<div class="${['Description', 'Printing notes'].includes(label) ? 'info-wide' : ''}"><dt>${label}</dt><dd>${escape(value)}</dd></div>`);
  host.hidden = !rows.length && !project?.raw;
  host.innerHTML = host.hidden ? '' : `<h3>File and project information</h3><dl>${rows.join('')}</dl>${project?.sourceUrl ? `<a href="${escape(project.sourceUrl)}" target="_blank" rel="noopener">View original Thingiverse page</a>` : ''}${project?.raw ? `<details><summary>Original README</summary><pre>${escape(project.raw)}</pre></details>` : ''}`;
}

async function refresh() {
  const data = await (await api('/api/library')).json();
  state.files = data.files; state.folders = data.folders; state.projects = data.projects || []; state.hiddenLibraryFolders = data.hiddenLibraryFolders || []; state.writable = data.writable;
  state.currentUser = data.user; accountButton.hidden = !data.user; accountButton.textContent = data.user ? `Sign out · ${data.user.username}` : ''; $('settings').hidden = !!data.user && data.user.role !== 'admin';
  for (const selectedPath of state.selectedPaths) if (!state.files.some(file => file.path === selectedPath)) state.selectedPaths.delete(selectedPath);
  const branches = state.folders.filter(folder => state.folders.some(candidate => candidate.startsWith(`${folder}/`)));
  for (const folder of branches) if (!state.knownBranchFolders.has(folder)) state.collapsedFolders.add(folder);
  state.knownBranchFolders = new Set(branches);
  state.config = data.config;
  if (!data.config?.smb && !data.files.length && !localStorage.getItem('setup-dismissed') && !setupDialog.open) setupDialog.showModal();
  state.scanning = data.scanning;
  $('app-version').textContent = `v${data.version || '?'}`;
  $('scan-progress').hidden = !data.scanning; if (data.scanning) { const progress = data.scan || {}; $('scan-phase').textContent = progress.phase === 'extracting' ? 'Reading model details' : 'Scanning folders'; $('scan-current').textContent = progress.current || ''; $('scan-meter').max = progress.total || 1; $('scan-meter').value = progress.total ? progress.processed : 0; $('scan-meter').removeAttribute('value'); if (progress.total) $('scan-meter').value = progress.processed; $('scan-pause').textContent = progress.paused ? 'Resume' : 'Pause'; }
  if (!state.initialized) { $('sort').value = data.config?.defaultSort || 'modified'; state.initialized = true; }
  $('banner').hidden = !data.error; $('banner').textContent = data.error || '';
  const sourceName = data.config?.smb ? `${data.config.smb.host} · ${data.config.smb.share}` : 'Local library';
  $('connection').textContent = data.error ? 'Library needs attention' : data.scanning ? `${state.files.length.toLocaleString()} files · Updating library…` : `${state.files.length.toLocaleString()} files · ${sourceName}`;
  $('library-name').textContent = data.config?.smb?.share || 'Local library';
  $('mount-mode').textContent = state.writable ? (data.config?.smb ? 'SMB editing enabled' : 'File editing enabled') : 'Read-only access';
  $('library-footer').textContent = data.scanning ? (data.scannedAt ? `Updating library… ${state.files.length.toLocaleString()} cached models are available` : 'Connecting and building the model catalog…') : data.scannedAt ? `Last scan ${new Date(data.scannedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${state.hiddenLibraryFolders.length ? ` · ${state.hiddenLibraryFolders.length} OpenSCAD library folder${state.hiddenLibraryFolders.length === 1 ? '' : 's'} hidden` : ''}` : 'Waiting for the library connection';
  for (const id of ['import', 'new-scad', 'new-folder', 'move', 'delete-file']) { $(id).disabled = !state.writable; $(id).title = state.writable ? '' : 'Enable LIBRARY_WRITABLE in your Docker settings to change files.'; }
  refreshFilterOptions(); drawNav(); drawFiles();
  clearTimeout(state.scanPoll);
  if (data.scanning) state.scanPoll = setTimeout(() => refresh().catch(() => {}), 2000);
}
function drawNav() {
  let mobile = $('mobile-browse');
  if (!mobile) { mobile = document.createElement('select'); mobile.id = 'mobile-browse'; mobile.className = 'mobile-browse'; mobile.setAttribute('aria-label', 'Browse folders and collections'); document.querySelector('.library-heading').after(mobile); mobile.addEventListener('change', () => { const value = JSON.parse(mobile.value); setMode(value[0], value[1]); }); }
  const modes = [['all', '', 'All models'], ['favorites', '', 'Favorites'], ['duplicates', '', 'Duplicates'], ['missing', '', 'Missing details'], ...state.folders.map(folder => ['folder', folder, `Folder: ${folder}`]), ...state.projects.map(project => ['project', project.id, `Project: ${project.name}`]), ...[...new Set(state.files.map(file => file.collection).filter(Boolean))].sort().map(name => ['collection', name, `Collection: ${name}`])];
  mobile.innerHTML = modes.map(([mode, value, label]) => `<option value="${escape(JSON.stringify([mode, value]))}">${escape(label)}</option>`).join('');
  mobile.value = JSON.stringify([state.mode, state.mode === 'folder' ? state.folder : state.mode === 'collection' ? state.collection : state.mode === 'project' ? state.projectId : '']);
  $('total').textContent = state.files.length; $('favorite-count').textContent = state.files.filter(f => f.favorite).length;
  $('all-files').classList.toggle('active', state.mode === 'all'); $('favorites').classList.toggle('active', state.mode === 'favorites');
  $('duplicates').classList.toggle('active', state.mode === 'duplicates'); $('duplicate-count').textContent = new Set(state.files.map(file => file.duplicateGroup).filter(Boolean)).size;
  const missing = file => !file.collection || !(file.tags || []).length || !(file.notes || file.projectInfo?.description || file.modelInfo?.standard?.description);
  $('missing-metadata').classList.toggle('active', state.mode === 'missing'); $('missing-count').textContent = state.files.filter(missing).length;
  const visibleFolders = state.folders.filter(folder => !folder.split('/').slice(0, -1).some((_, index, parts) => state.collapsedFolders.has(parts.slice(0, index + 1).join('/'))));
  $('folders').innerHTML = visibleFolders.length ? visibleFolders.map(folder => { const source = (state.config?.scanFolders || []).filter(root => folder === root || folder.startsWith(`${root}/`)).sort((a, b) => b.length - a.length)[0], depth = source ? folder === source ? 0 : folder.slice(source.length + 1).split('/').length : folder.split('/').length - 1, hasChildren = state.folders.some(item => item.startsWith(`${folder}/`)); return `<div class="folder-row" style="padding-left:${Math.min(depth, 5) * 12}px">${hasChildren ? `<button class="folder-toggle" data-toggle-folder="${escape(folder)}" aria-label="${state.collapsedFolders.has(folder) ? 'Expand' : 'Collapse'} ${escape(folder)}">${state.collapsedFolders.has(folder) ? '▸' : '▾'}</button>` : '<span class="folder-toggle-spacer"></span>'}<button class="folder ${state.mode === 'folder' && state.folder === folder ? 'active' : ''}" data-folder="${escape(folder)}" title="${escape(folder)}"><span class="folder-symbol">▱</span>${escape(folder.split('/').at(-1))}</button></div>`; }).join('') : '<p class="empty" style="padding:10px">Folders appear here when the library is scanned.</p>';
  const collections = [...new Set([...(state.config?.collections || []), ...state.files.map(f => f.collection).filter(Boolean)])].sort();
  $('collections').innerHTML = collections.length ? collections.map(name => `<button class="folder ${state.mode === 'collection' && state.collection === name ? 'active' : ''}" data-collection="${escape(name)}">◈ ${escape(name)}</button>`).join('') : '<p class="empty" style="padding:0 12px;text-align:left">Add a collection in a model’s details.</p>';
  $('projects').innerHTML = state.projects.length ? state.projects.map(project => `<button class="folder ${state.mode === 'project' && state.projectId === project.id ? 'active' : ''}" data-project="${escape(project.id)}">⬡ ${escape(project.name)} <small>${state.files.filter(file => file.projectId === project.id).length}</small></button>`).join('') : '<p class="empty" style="padding:0 12px;text-align:left">Select related files to create a project.</p>';
  $('collection-options').innerHTML = collections.map(name => `<option value="${escape(name)}"></option>`).join('');
  $('project').innerHTML = '<option value="">No project</option>' + state.projects.map(project => `<option value="${escape(project.id)}">${escape(project.name)}</option>`).join('');
  $('source-link').innerHTML = '<option value="">No linked source</option>' + state.files.filter(file => file.type === 'scad').map(file => `<option value="${escape(file.path)}">${escape(file.path)}</option>`).join('');
  $('view-title').textContent = state.mode === 'favorites' ? 'Favorites' : state.mode === 'duplicates' ? 'Duplicates' : state.mode === 'missing' ? 'Missing details' : state.mode === 'folder' ? state.folder.split('/').at(-1) : state.mode === 'collection' ? state.collection : state.mode === 'project' ? state.projects.find(project => project.id === state.projectId)?.name || 'Project' : 'All models';
}
function drawFiles() {
  const search = $('search').value.trim().toLowerCase(), type = $('type').value;
  const filters = readFilters(), megabyte = 1048576;
  const result = state.files.filter(f => {
    const standard = f.modelInfo?.standard || {}, dimensions = f.dimensions || standard.dimensions || [], longest = dimensions.length ? Math.max(...dimensions.map(Number).filter(Number.isFinite)) : null;
    return (!type || f.type === type) && (state.mode !== 'favorites' || f.favorite) && (state.mode !== 'duplicates' || f.duplicateGroup) && (state.mode !== 'missing' || !f.collection || !(f.tags || []).length || !(f.notes || f.projectInfo?.description || f.modelInfo?.standard?.description)) && (state.mode !== 'folder' || f.folder === state.folder || f.folder.startsWith(`${state.folder}/`)) && (state.mode !== 'collection' || f.collection === state.collection) && (state.mode !== 'project' || f.projectId === state.projectId) && matchesModelSearch(f, search) && (!filters.collection || f.collection === filters.collection) && (!filters.designer || String(standard.designer || '').toLowerCase().includes(filters.designer.toLowerCase())) && (!filters.license || String(standard.license || f.projectInfo?.license || '').toLowerCase().includes(filters.license.toLowerCase())) && (!filters.slicer || String(standard.application || '').toLowerCase().includes(filters.slicer.toLowerCase())) && (!filters.sizeMin || f.size >= Number(filters.sizeMin) * megabyte) && (!filters.sizeMax || f.size <= Number(filters.sizeMax) * megabyte) && (!filters.dimensionMin || longest != null && longest >= Number(filters.dimensionMin)) && (!filters.dimensionMax || longest != null && longest <= Number(filters.dimensionMax)) && (!filters.dateAfter || f.modified.slice(0, 10) >= filters.dateAfter) && (!filters.dateBefore || f.modified.slice(0, 10) <= filters.dateBefore);
  });
  const chosenSort = $('sort').value === 'name' ? (a, b) => a.name.localeCompare(b.name) : $('sort').value === 'size' ? (a, b) => b.size - a.size : (a, b) => b.modified.localeCompare(a.modified);
  result.sort(state.mode === 'duplicates' ? (a, b) => a.duplicateGroup.localeCompare(b.duplicateGroup) || chosenSort(a, b) : chosenSort);
  $('result-count').textContent = result.length;
  let previousGroup = '';
  $('file-list').innerHTML = result.length ? result.slice(0, state.limit).map(f => { const heading = state.mode === 'duplicates' && f.duplicateGroup !== previousGroup ? `<div class="duplicate-group"><strong>Duplicate set</strong><span>${f.duplicateCount} identical files — check only the copies you want to delete</span></div>` : ''; previousGroup = f.duplicateGroup || ''; const project = state.projects.find(item => item.id === f.projectId); return `${heading}<div class="file-row ${state.selectedPaths.has(f.path) ? 'bulk-selected' : ''}"><input class="bulk-check" type="checkbox" data-select-file="${escape(f.path)}" aria-label="Select ${escape(f.path)} for bulk actions" ${state.selectedPaths.has(f.path) ? 'checked' : ''}><button class="file-card ${state.selected?.path === f.path ? 'selected' : ''}" data-file="${escape(f.path)}" aria-pressed="${state.selected?.path === f.path}">${f.thumbnail ? `<img class="model-thumb" src="${escape(f.thumbnail)}" alt="">` : `<span class="type-icon ${f.type === 'scad' ? 'scad' : f.type === '3mf' ? 'mf' : ''}">${f.type === 'scad' ? '{ }' : f.type.toUpperCase()}</span>`}<span class="file-text"><span class="file-name">${escape(f.name)}</span><span class="file-sub ${state.mode === 'duplicates' ? 'full-path' : ''}">${bytes(f.size)} · ${escape(state.mode === 'duplicates' ? f.path : f.folder || 'Model library')}</span>${project ? `<span class="relationship-badge">${escape(project.name)} · ${escape(roleName(f.role))}</span>` : ''}${f.tags?.length ? `<span class="file-tags">${f.tags.slice(0, 3).map(tag => `<span data-search-tag="${escape(tag)}" title="Search this tag">${escape(tag)}</span>`).join('')}</span>` : ''}</span>${f.favorite ? '<span class="star" aria-label="Favorite">★</span>' : ''}</button></div>`; }).join('') : `<div class="empty"><strong>${state.files.length ? 'No matching models' : 'Your shelf is ready'}</strong><p>${state.files.length ? 'Try another search or file type.' : 'Connect your model library, then rescan to bring your models into view.'}</p></div>`;
  $('bulk-bar').hidden = !state.selectedPaths.size; $('bulk-count').textContent = `${state.selectedPaths.size} selected`;
  $('show-more').hidden = result.length <= state.limit;
}
const filterIds = ['filter-collection', 'filter-designer', 'filter-license', 'filter-slicer', 'filter-size-min', 'filter-size-max', 'filter-dimension-min', 'filter-dimension-max', 'filter-date-after', 'filter-date-before'];
function readFilters() { return { collection: $('filter-collection').value, designer: $('filter-designer').value.trim(), license: $('filter-license').value.trim(), slicer: $('filter-slicer').value.trim(), sizeMin: $('filter-size-min').value, sizeMax: $('filter-size-max').value, dimensionMin: $('filter-dimension-min').value, dimensionMax: $('filter-dimension-max').value, dateAfter: $('filter-date-after').value, dateBefore: $('filter-date-before').value }; }
function allSearchState() { return { search: $('search').value, type: $('type').value, sort: $('sort').value, filters: Object.fromEntries(filterIds.map(id => [id, $(id).value])) }; }
function applySearchState(saved = {}) { $('search').value = saved.search || ''; $('type').value = saved.type || ''; $('sort').value = saved.sort || 'modified'; for (const id of filterIds) $(id).value = saved.filters?.[id] || ''; state.limit = 60; drawFiles(); }
function savedSearches() { try { return JSON.parse(localStorage.getItem('model-manager-saved-searches') || '{}'); } catch { return {}; } }
function drawSavedSearches(selected = '') { const searches = savedSearches(); $('saved-search').innerHTML = '<option value="">Saved searches…</option>' + Object.keys(searches).sort().map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join(''); $('saved-search').value = selected; $('delete-search').disabled = !selected; }
function refreshFilterOptions() {
  const optionValues = (id, values) => { $(id).innerHTML = [...new Set(values.filter(Boolean))].sort().map(value => `<option value="${escape(value)}"></option>`).join(''); };
  const current = $('filter-collection').value, collections = [...new Set([...(state.config?.collections || []), ...state.files.map(f => f.collection).filter(Boolean)])].sort(); $('filter-collection').innerHTML = '<option value="">Any collection</option>' + collections.map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join(''); $('filter-collection').value = current;
  optionValues('designer-options', state.files.map(f => f.modelInfo?.standard?.designer)); optionValues('license-options', state.files.flatMap(f => [f.modelInfo?.standard?.license, f.projectInfo?.license])); optionValues('slicer-options', state.files.map(f => f.modelInfo?.standard?.application));
}
function setMode(mode, value) { state.mode = mode; if (mode === 'folder') state.folder = value; if (mode === 'collection') state.collection = value; if (mode === 'project') state.projectId = value; state.limit = 60; drawNav(); drawFiles(); }
function roleName(role) { return ({ part: 'Part', assembly: 'Assembly', alternate: 'Alternate version', source: 'Source file', export: 'Generated export', support: 'Supporting file' })[role] || 'Unspecified'; }
function drawRelationship(file) {
  const project = state.projects.find(item => item.id === file.projectId), members = project ? state.files.filter(item => item.projectId === project.id) : [];
  $('project-relationship').hidden = !project && !file.sourcePath && !file.convertedFrom;
  $('project-relationship').innerHTML = !project && !file.sourcePath && !file.convertedFrom ? '' : `<div><strong>${project ? escape(project.name) : 'Linked model files'}</strong><span>${project ? `${members.length} related file${members.length === 1 ? '' : 's'}` : ''}</span></div><div class="project-members">${members.map(member => `<button type="button" data-related-file="${escape(member.path)}" class="${member.path === file.path ? 'current' : ''}"><b>${escape(roleName(member.role))}</b><span>${escape(member.name)}</span></button>`).join('')}</div>${file.sourcePath ? `<p>Generated from <button type="button" data-related-file="${escape(file.sourcePath)}">${escape(file.sourcePath)}</button></p>` : ''}${file.convertedFrom ? `<p>Converted from <button type="button" data-related-file="${escape(file.convertedFrom)}">${escape(file.convertedFrom)}</button></p>` : ''}`;
}
function drawPrintHistory(file) {
  const records = file.prints || [], successful = records.filter(record => record.result === 'success').reduce((sum, record) => sum + (record.quantity || 1), 0), labels = { success: 'Successful', failed: 'Failed', partial: 'Partial', test: 'Test print' };
  $('print-summary').textContent = records.length ? `${records.length} record${records.length === 1 ? '' : 's'} · ${successful} successful item${successful === 1 ? '' : 's'}` : 'No prints recorded';
  $('print-records').innerHTML = records.length ? records.map(record => `<article class="print-record"><div class="print-result ${escape(record.result)}">${escape(labels[record.result] || record.result)}</div>${record.photo ? `<img src="/api/print-photo/${escape(record.photo)}" alt="Completed print">` : ''}<div class="print-record-body"><strong>${escape(record.date)}</strong><span>${escape([record.printer, record.filament, record.color].filter(Boolean).join(' · ') || 'No equipment details')}</span><span>${escape([record.nozzle ? `${record.nozzle} mm nozzle` : '', record.layerHeight ? `${record.layerHeight} mm layers` : '', `${record.quantity || 1} printed`].filter(Boolean).join(' · '))}</span>${record.notes ? `<p>${escape(record.notes)}</p>` : ''}</div><button type="button" data-delete-print="${escape(record.id)}" aria-label="Delete print record">Delete</button></article>`).join('') : '<p class="empty-print-history">Record successful settings and failures so the next print is easier.</p>';
}
async function selectFile(file) {
  if (file.path === state.selected?.path) return;
  if (!await mayLeave()) return;
  state.selected = file; state.dirty = false; state.metaDirty = false; state.renderedSource = undefined;
  $('print-form').hidden = true; $('print-form').reset(); $('print-quantity').value = '1';
  const token = ++state.selectionToken; ++state.renderToken;
  $('welcome').hidden = true; $('detail').hidden = false;
  $('selected-name').textContent = file.name; $('selected-path').textContent = `Model library / ${file.folder || ''}`;
  $('download').href = fileUrl(file, true); $('favorite').textContent = file.favorite ? '★' : '☆'; $('favorite').setAttribute('aria-label', file.favorite ? 'Remove from favorites' : 'Add to favorites');
  $('reset-cover').hidden = !file.customCover;
  $('collection').value = file.collection || ''; $('tags').value = (file.tags || []).join(', '); $('notes').value = file.notes || ''; $('metadata-state').textContent = '';
  $('project').value = file.projectId || ''; $('file-role').value = file.role || ''; $('source-link').value = file.sourcePath || ''; drawRelationship(file); drawPrintHistory(file);
  $('file-info').textContent = `${file.type.toUpperCase()} · ${bytes(file.size)} · ${new Date(file.modified).toLocaleDateString()}`;
  const directBambu = file.type === '3mf', localBridge = !!bridgeToken(); $('slicer-choice').querySelector('[value="bambu-direct"]').disabled = !directBambu; if (!directBambu && $('slicer-choice').value === 'bambu-direct') $('slicer-choice').value = 'bridge'; $('open-slicer').disabled = file.type === 'scad'; $('open-slicer').textContent = file.type === 'stl' && !localBridge ? 'Download for slicer' : 'Open in slicer'; $('open-slicer').title = file.type === 'scad' ? 'Render or export the OpenSCAD model to STL before opening it in a slicer.' : file.type === 'stl' && !localBridge ? 'Bambu Studio only accepts 3MF files through its web link. Download this STL and open the local file.' : '';
  $('convert-3mf').hidden = file.type !== 'stl'; $('convert-3mf').disabled = !state.writable; $('convert-3mf').title = state.writable ? 'Create a 3MF copy with the available model and project details.' : 'File editing must be enabled to save a converted 3MF.';
  drawExtractedInfo(file);
  const scad = file.type === 'scad';
  $('scad-actions').hidden = !scad; $('dependency-panel').hidden = !scad; $('scad-panel').hidden = !scad; $('scad-resizer').hidden = !scad; $('model-workspace').classList.toggle('scad', scad); $('render-console').hidden = true; $('export-stl').hidden = true; $('save-render').hidden = true; $('cancel-render').hidden = true; $('render').disabled = false;
  $('viewer-label').textContent = scad ? 'RENDERED PREVIEW' : '3D PREVIEW';
  try {
    if (!viewer) viewer = new ModelViewer($('viewer'), $('viewer-status'), $('dimensions'));
    viewer.clear(scad ? 'Edit your source, then render to see the model.' : 'Loading model…'); viewer.resize();
  } catch (e) { $('viewer-status').hidden = false; $('viewer-status').textContent = '3D preview needs WebGL. Enable hardware acceleration in your browser.'; }
  if (scad && editor) { editor.destroy(); editor = null; }
  drawFiles();
  try {
    if (scad) {
      const source = await (await api(`/api/source?path=${encodeURIComponent(file.path)}`)).json(); if (token !== state.selectionToken) return;
      state.source = source.source; state.revision = source.revision;
      editor = new EditorView({ parent: $('editor'), doc: source.source, extensions: [basicSetup, StreamLanguage.define(clike({ keywords: { module: true, function: true, include: true, use: true, if: true, else: true, for: true, let: true, each: true, assert: true }, blockKeywords: { module: true, function: true }, atoms: { true: true, false: true, undef: true } })), EditorView.theme({ '&': { color: '#dfebf8', backgroundColor: '#151e29' }, '.cm-content': { caretColor: '#ef9e49' } }, { dark: true }), EditorView.updateListener.of(update => { if (update.docChanged) draftChanged(); })] });
      draftChanged(); showEditorMode(state.editorMode || 'customizer');
    } else {
      const buffer = await (await api(fileUrl(file))).arrayBuffer(); if (token !== state.selectionToken) return;
      viewer?.show(buffer, file.type);
    }
  } catch (e) { if (token === state.selectionToken) { viewer?.clear(e.message); toast(e.message); } }
}
async function saveDetails(favorite = state.selected.favorite) {
  if (state.saving) return;
  state.saving = true;
  try {
  const current = state.selected;
  const item = await request('/api/meta', 'PUT', { path: current.path, collection: $('collection').value, tags: $('tags').value.split(','), notes: $('notes').value, favorite, projectId: $('project').value, role: $('file-role').value, sourcePath: $('source-link').value });
  Object.assign(current, item); const listed = state.files.find(f => f.path === current.path); if (listed) Object.assign(listed, item);
  state.metaDirty = false; $('favorite').textContent = item.favorite ? '★' : '☆'; $('favorite').setAttribute('aria-label', item.favorite ? 'Remove from favorites' : 'Add to favorites'); $('metadata-state').textContent = 'Details saved'; drawNav(); drawRelationship(current); drawFiles();
  } finally { state.saving = false; }
}
async function promptPath(title, description, initial, onSubmit, options = {}) {
  $('dialog-title').textContent = title; $('dialog-description').textContent = description; $('path-input').value = initial; $('dialog-error').textContent = '';
  $('path-delete-option').hidden = !options.deleteOriginal; $('path-delete-original').checked = false; $('dialog-progress').hidden = true;
  $('path-dialog').showModal(); $('path-input').focus();
  $('path-form').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter, originalText = button.textContent; button.disabled = true;
    if (options.busyText) { button.textContent = options.busyText; $('dialog-progress').hidden = false; $('path-input').disabled = true; $('path-delete-original').disabled = true; $('dialog-cancel').disabled = true; }
    try { await onSubmit($('path-input').value.trim(), { deleteOriginal: $('path-delete-original').checked }); $('path-dialog').close(); }
    catch (e) { $('dialog-error').textContent = e.message; }
    finally { button.disabled = false; button.textContent = originalText; $('dialog-progress').hidden = true; $('path-input').disabled = false; $('path-delete-original').disabled = false; $('dialog-cancel').disabled = false; }
  };
}
function collectionRow(name = '') {
  const row = document.createElement('div'); row.className = 'admin-row';
  row.innerHTML = `<input class="admin-collection-name" value="${escape(name)}" maxlength="100" placeholder="Collection name" aria-label="Collection name"><button type="button" class="remove-admin-row" aria-label="Remove ${escape(name || 'collection')}">Remove</button>`;
  row.querySelector('input').addEventListener('input', markSettingsDirty);
  row.querySelector('button').addEventListener('click', () => { row.remove(); markSettingsDirty(); });
  return row;
}
function markSettingsDirty() { state.settingsDirty = true; $('settings-state').textContent = 'Unsaved settings'; }
async function loadSettings() {
  const settings = await (await api('/api/settings')).json(); state.adminSettings = settings; state.settingsDirty = false;
  $('admin-collections').replaceChildren(...(settings.collections.length ? settings.collections : ['']).map(collectionRow));
  $('admin-folders').innerHTML = settings.smb ? (settings.scanFolders.length ? settings.scanFolders.map(folder => `<div class="folder-check"><span>▱ ${escape(folder)}</span><b>Included source</b></div>`).join('') : '<div class="folder-check"><span>▱ Entire share</span><b>Included source</b></div>') : '<p class="settings-note">No network folders have been added.</p>';
  $('admin-sort').value = settings.defaultSort; $('admin-interval').value = String(settings.scanInterval);
  $('backup-interval').value = String(settings.backupInterval ?? 24); $('backup-retention').value = String(settings.backupRetention ?? 7);
  $('recycle-retention').value = String(settings.recycleRetention ?? 30);
  const backupData = await (await api('/api/backups')).json(); $('backup-list').innerHTML = backupData.backups.length ? backupData.backups.map(item => `<a class="button" href="/api/backups/${encodeURIComponent(item.name)}" download><span>${new Date(item.created).toLocaleString()}</span><small>${bytes(item.size)}</small></a>`).join('') : '<span>No automatic backups are available yet.</span>'; $('download-all-backups').disabled = !backupData.backups.length;
  if (!$('admin-interval').value) { const option = new Option(`Every ${settings.scanInterval} seconds`, settings.scanInterval); $('admin-interval').add(option); $('admin-interval').value = String(settings.scanInterval); }
  $('admin-library-path').textContent = settings.libraryPath; $('admin-access').textContent = settings.writable ? 'Read and write' : 'Read-only files';
  $('network-summary').innerHTML = settings.smb ? `<strong>${escape(settings.libraryPath)}</strong><span>${escape(settings.smb.username || 'Guest access')}</span><span>${settings.scanFolders.length ? `Included folders: ${settings.scanFolders.map(escape).join(', ')}` : 'Included folders: entire share'}</span>` : '<span>Using the local fallback library. Add a network location to connect directly to a NAS.</span>';
  $('disconnect-network').hidden = !settings.smb;
  $('admin-preview-limit').textContent = `${settings.limits.previewMb} MB per file`; $('admin-render-timeout').textContent = `${settings.limits.renderSeconds} seconds`;
  $('admin-version').textContent = `v${settings.version || '?'}`;
  $('auth-enabled').checked = settings.auth?.enabled === true; $('auth-proxy-header').value = settings.auth?.proxyHeader || '';
  $('auth-users').innerHTML = settings.auth?.users?.length ? settings.auth.users.map(user => `<div class="folder-check"><span><strong>${escape(user.username)}</strong> · ${escape(user.role)}</span><button type="button" data-remove-user="${escape(user.id)}" class="danger">Remove</button></div>`).join('') : '<p class="settings-note">No local users have been created.</p>';
  $('settings-state').textContent = 'Settings are saved';
  await loadHistory();
  if (bridgeToken()) detectSlicers().catch(() => { $('bridge-status').textContent = 'The paired desktop bridge is not currently running.'; });
}
async function loadHistory() { const [recycle, activity] = await Promise.all([request('/api/recycle', 'GET'), request('/api/history', 'GET')]); $('recycle-list').innerHTML = recycle.items.length ? recycle.items.map(item => `<div class="activity-row"><div><strong>${escape(item.path)}</strong><small>${new Date(item.deletedAt).toLocaleString()} · ${escape(item.user)} · ${bytes(item.size)}</small></div><span><button type="button" data-restore-recycle="${escape(item.id)}">Restore</button><button type="button" class="danger" data-purge-recycle="${escape(item.id)}">Delete forever</button></span></div>`).join('') : '<p class="settings-note">The recycle bin is empty.</p>'; $('history-list').innerHTML = activity.history.length ? activity.history.map(item => `<div class="activity-row"><div><strong>${escape(item.action)}</strong><small>${escape(item.path)}${item.target ? ` → ${escape(item.target)}` : ''}</small></div><small>${new Date(item.at).toLocaleString()} · ${escape(item.user)}</small></div>`).join('') : '<p class="settings-note">No changes have been recorded yet.</p>'; }
async function showSettings() {
  if (!await mayLeave()) return;
  $('settings-page').hidden = false; document.querySelector('.workspace').hidden = true;
  for (const id of ['scan', 'new-scad', 'import']) $(id).hidden = true;
  $('settings').hidden = true; location.hash = 'settings'; await loadSettings();
}
function showLibrary() {
  $('settings-page').hidden = true; document.querySelector('.workspace').hidden = false;
  for (const id of ['scan', 'new-scad', 'import']) $(id).hidden = false;
  $('settings').hidden = false; location.hash = 'library';
}
const folderPrefix = () => state.mode === 'folder' ? `${state.folder}/` : '';
action('all-files', () => setMode('all')); action('favorites', () => setMode('favorites')); action('duplicates', () => setMode('duplicates')); action('missing-metadata', () => setMode('missing'));
action('expand-folders', () => { state.collapsedFolders.clear(); drawNav(); });
action('collapse-folders', () => { state.collapsedFolders = new Set(state.folders.filter(folder => state.folders.some(candidate => candidate.startsWith(`${folder}/`)))); drawNav(); });
$('folders').addEventListener('click', event => { const toggle = event.target.closest('[data-toggle-folder]'); if (toggle) { const folder = toggle.dataset.toggleFolder; state.collapsedFolders.has(folder) ? state.collapsedFolders.delete(folder) : state.collapsedFolders.add(folder); drawNav(); return; } const button = event.target.closest('[data-folder]'); if (button) setMode('folder', button.dataset.folder); });
$('collections').addEventListener('click', event => { const button = event.target.closest('[data-collection]'); if (button) setMode('collection', button.dataset.collection); });
$('projects').addEventListener('click', event => { const button = event.target.closest('[data-project]'); if (button) setMode('project', button.dataset.project); });
$('project-relationship').addEventListener('click', event => { const button = event.target.closest('[data-related-file]'); if (button) selectFile(state.files.find(file => file.path === button.dataset.relatedFile)).catch(error => toast(error.message)); });
$('file-list').addEventListener('click', event => {
  const tag = event.target.closest('[data-search-tag]');
  if (tag) {
    event.stopPropagation();
    $('search').value = `tag:${tag.dataset.searchTag}`;
    state.limit = 60;
    drawFiles();
    return;
  }
  const button = event.target.closest('[data-file]');
  if (button) selectFile(state.files.find(f => f.path === button.dataset.file)).catch(e => toast(e.message));
});
$('file-list').addEventListener('change', event => { const checkbox = event.target.closest('[data-select-file]'); if (!checkbox) return; checkbox.checked ? state.selectedPaths.add(checkbox.dataset.selectFile) : state.selectedPaths.delete(checkbox.dataset.selectFile); drawFiles(); });
action('bulk-clear', () => { state.selectedPaths.clear(); drawFiles(); });
action('bulk-collection', async () => { const collection = prompt('Collection for selected models:', ''); if (collection == null) return; await request('/api/bulk', 'POST', { action: 'collection', paths: [...state.selectedPaths], collection }); await refresh(); toast('Collection updated.'); });
action('bulk-tags', async () => { const tags = prompt('Tags to add, separated by commas:', ''); if (tags == null) return; await request('/api/bulk', 'POST', { action: 'tags', paths: [...state.selectedPaths], tags: tags.split(',') }); await refresh(); toast('Tags added.'); });
action('bulk-project', async () => { const name = prompt('Project name for the selected files:', ''); if (!name?.trim()) return; const project = await request('/api/projects', 'POST', { name, paths: [...state.selectedPaths] }); state.selectedPaths.clear(); await refresh(); setMode('project', project.id); toast(`${project.updated} files grouped as ${project.name}.`); });
action('bulk-download', async () => { const paths = [...state.selectedPaths]; const response = await api('/api/bulk-download', { method: 'POST', body: JSON.stringify({ paths }) }); saveBlob(await response.blob(), `3d-model-manager-${new Date().toISOString().slice(0, 10)}.zip`); toast(`${paths.length} selected files downloaded as one ZIP.`); });
action('bulk-move', async () => { const folder = prompt('Move selected models to this existing library folder:', state.mode === 'folder' ? state.folder : ''); if (folder == null) return; await request('/api/bulk', 'POST', { action: 'move', paths: [...state.selectedPaths], folder }); state.selectedPaths.clear(); await refresh(); toast('Selected files moved.'); });
action('bulk-delete', async () => { const paths = [...state.selectedPaths]; if (!paths.length) return; const listed = paths.slice(0, 10).map(path => `• ${path}`).join('\n'), more = paths.length > 10 ? `\n• …and ${paths.length - 10} more` : ''; if (!confirm(`Move these ${paths.length} selected files to the recycle bin?\n\n${listed}${more}`)) return; await request('/api/bulk', 'POST', { action: 'delete', paths }); state.selectedPaths.clear(); state.selected = null; $('detail').hidden = true; $('welcome').hidden = false; await refresh(); toast('Selected files moved to the recycle bin.'); });
for (const id of ['search', 'type', 'sort']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { state.limit = 60; drawFiles(); });
for (const id of filterIds) $(id).addEventListener(['filter-collection', 'filter-date-after', 'filter-date-before'].includes(id) ? 'change' : 'input', () => { state.limit = 60; drawFiles(); });
action('advanced-toggle', () => { const open = $('advanced-filters').hidden; $('advanced-filters').hidden = !open; $('advanced-toggle').setAttribute('aria-expanded', String(open)); $('advanced-toggle').classList.toggle('active', open); });
action('clear-filters', () => { applySearchState({ sort: $('sort').value }); $('saved-search').value = ''; $('delete-search').disabled = true; });
action('save-search', () => { const name = prompt('Name this search:', ''); if (!name?.trim()) return; const searches = savedSearches(); searches[name.trim().slice(0, 80)] = allSearchState(); localStorage.setItem('model-manager-saved-searches', JSON.stringify(searches)); drawSavedSearches(name.trim().slice(0, 80)); toast('Search saved in this browser.'); });
$('saved-search').addEventListener('change', () => { const name = $('saved-search').value, saved = savedSearches()[name]; $('delete-search').disabled = !name; if (saved) applySearchState(saved); });
action('delete-search', () => { const name = $('saved-search').value; if (!name) return; const searches = savedSearches(); delete searches[name]; localStorage.setItem('model-manager-saved-searches', JSON.stringify(searches)); drawSavedSearches(); toast('Saved search deleted.'); });
drawSavedSearches();
action('show-more', () => { state.limit += 60; drawFiles(); });
action('scan', async () => { $('scan').disabled = true; try { await request('/api/scan/start', 'POST'); await refresh(); toast('Library scan started.'); } finally { $('scan').disabled = false; } });
action('scan-pause', async () => { await request('/api/scan/pause', 'POST'); await refresh(); });
action('scan-cancel', async () => { await request('/api/scan/cancel', 'POST'); await refresh(); });
action('favorite', () => saveDetails(!state.selected.favorite));
action('set-cover', () => $('cover-input').click());
$('cover-input').addEventListener('change', async () => {
  const image = $('cover-input').files[0], selected = state.selected; if (!image || !selected) return;
  $('set-cover').disabled = true;
  try { const result = await (await api(`/api/cover?path=${encodeURIComponent(selected.path)}`, { method: 'PUT', body: image })).json(); selected.thumbnail = result.thumbnail; selected.customCover = true; const listed = state.files.find(file => file.path === selected.path); if (listed) Object.assign(listed, { thumbnail: result.thumbnail, customCover: true }); $('reset-cover').hidden = false; drawFiles(); toast('Custom cover saved.'); }
  finally { $('set-cover').disabled = false; $('cover-input').value = ''; }
});
action('reset-cover', async () => {
  if (!state.selected) return; const selected = state.selected, result = await request(`/api/cover?path=${encodeURIComponent(selected.path)}`, 'DELETE');
  selected.thumbnail = result.thumbnail; delete selected.customCover; const listed = state.files.find(file => file.path === selected.path); if (listed) { listed.thumbnail = result.thumbnail; delete listed.customCover; } $('reset-cover').hidden = true; drawFiles(); toast(result.thumbnail ? 'Automatic cover restored.' : 'Custom cover removed.');
});
$('metadata-form').addEventListener('input', () => { state.metaDirty = true; $('metadata-state').textContent = 'Unsaved details'; });
$('metadata-form').addEventListener('submit', async event => { event.preventDefault(); $('save-meta').disabled = true; try { await saveDetails(); } catch (e) { toast(e.message); } finally { $('save-meta').disabled = false; } });
action('toggle-print-form', () => { $('print-form').hidden = !$('print-form').hidden; if (!$('print-form').hidden) { $('print-date').value ||= new Date().toISOString().slice(0, 10); $('print-printer').focus(); } });
action('cancel-print', () => { $('print-form').hidden = true; $('print-form').reset(); $('print-quantity').value = '1'; });
$('print-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!state.selected) return; const selected = state.selected, button = event.submitter; button.disabled = true; button.textContent = 'Saving…';
  try {
    const record = await request('/api/prints', 'POST', { path: selected.path, date: $('print-date').value, result: $('print-result').value, printer: $('print-printer').value, filament: $('print-filament').value, color: $('print-color').value, nozzle: $('print-nozzle').value, layerHeight: $('print-layer').value, quantity: $('print-quantity').value, notes: $('print-notes').value });
    const photo = $('print-photo').files[0]; if (photo) { const uploaded = await (await api(`/api/print-photo?path=${encodeURIComponent(selected.path)}&id=${encodeURIComponent(record.id)}`, { method: 'PUT', body: photo })).json(); record.photo = uploaded.photo.split('/').pop(); }
    selected.prints ||= []; selected.prints.unshift(record); const listed = state.files.find(file => file.path === selected.path); if (listed && listed !== selected) listed.prints = selected.prints;
    $('print-form').reset(); $('print-quantity').value = '1'; $('print-date').value = new Date().toISOString().slice(0, 10); $('print-form').hidden = true; drawPrintHistory(selected); toast(record.result === 'failed' ? 'Failed print recorded for future reference.' : 'Print recorded.');
  } finally { button.disabled = false; button.textContent = 'Save print'; }
});
$('print-records').addEventListener('click', async event => {
  const button = event.target.closest('[data-delete-print]'); if (!button || !state.selected || !confirm('Delete this print-history record?')) return;
  button.disabled = true; try { await request(`/api/prints?path=${encodeURIComponent(state.selected.path)}&id=${encodeURIComponent(button.dataset.deletePrint)}`, 'DELETE'); state.selected.prints = (state.selected.prints || []).filter(record => record.id !== button.dataset.deletePrint); drawPrintHistory(state.selected); toast('Print record deleted.'); } finally { button.disabled = false; }
});
action('fit', () => viewer?.fit());
action('wireframe', () => { const enabled = $('wireframe').getAttribute('aria-pressed') !== 'true'; $('wireframe').setAttribute('aria-pressed', enabled); viewer?.setWireframe(enabled); });
action('open-slicer', async () => {
  if (!state.selected) return;
  if (state.selected.type === 'stl' && !bridgeToken()) { const response = await api(fileUrl(state.selected)); saveBlob(await response.blob(), state.selected.name); toast('STL downloaded. Open the downloaded file in Bambu Studio.'); return; }
  const link = await request('/api/open-link', 'POST', { path: state.selected.path }), absolute = new URL(link.url, location.href).href;
  if ($('slicer-choice').value === 'bambu-direct' && state.selected.type === '3mf') { const mac = /Mac/i.test(navigator.userAgent); location.href = mac ? `bambustudioopen://${absolute}` : `bambustudio://open?file=${encodeURIComponent(absolute)}`; return; }
  const selected = $('slicer-choice').value, result = await bridgeRequest('/open', { url: absolute, slicerPath: selected.startsWith('bridge:') ? selected.slice(7) : $('bridge-default').value }); toast(`Opened in ${result.slicer}.`);
});
action('convert-3mf', async () => {
  if (!state.selected || state.selected.type !== 'stl') return;
  const original = state.selected, desired = original.path.replace(/\.stl$/i, '.3mf'), occupied = new Set(state.files.map(file => file.path.toLocaleLowerCase()));
  let suggested = desired;
  if (occupied.has(suggested.toLocaleLowerCase())) {
    const stem = desired.replace(/\.3mf$/i, ''); let number = 1;
    do { suggested = `${stem}-converted${number > 1 ? `-${number}` : ''}.3mf`; number++; } while (occupied.has(suggested.toLocaleLowerCase()));
  }
  await promptPath('Convert STL to 3MF', 'Choose where to save the new 3MF. Available model notes, README details, attribution, and license information will be embedded.', suggested, async (target, options) => {
    const deleteOriginal = options.deleteOriginal;
    const result = await request('/api/convert', 'POST', { path: original.path, target, deleteOriginal });
    $('path-dialog').close();
    toast(result.originalDeleted ? 'Standard 3MF created and verified; the original STL was deleted.' : 'Standard 3MF created and verified; the original STL was kept.');
    state.selected = null; state.dirty = false; state.metaDirty = false;
    try { await refresh(); const converted = state.files.find(file => file.path === result.path); if (converted) await selectFile(converted); }
    catch { toast('The 3MF was created. Refresh the library to display it.'); }
  }, { deleteOriginal: true, busyText: 'Converting…' });
});
action('save-source', async () => {
  if (state.saving) return;
  state.saving = true;
  const selected = state.selected, text = editor.state.doc.toString(); $('save-source').disabled = true;
  try { const result = await request('/api/source', 'PUT', { path: selected.path, source: text, revision: state.revision }); state.source = text; state.revision = result.revision; draftChanged(); toast('Source saved. A backup of the previous version is in the app’s data folder.'); await refresh(); } finally { state.saving = false; draftChanged(); }
});
action('download-source', () => saveBlob(new Blob([editor.state.doc.toString()], { type: 'text/plain' }), state.selected.name));
action('export-stl', async event => {
  event.preventDefault();
  const link = $('export-stl'), response = await api(link.href), name = `${state.selected.name.replace(/\.scad$/i, '')}.stl`;
  saveBlob(await response.blob(), name); toast(`Downloaded ${name}`);
});
action('save-render', async () => { if (!state.jobId || !state.selected) return; const folder = state.selected.folder ? `${state.selected.folder}/` : '', suggested = `${folder}${state.selected.name.replace(/\.scad$/i, '')}.stl`; await promptPath('Save rendered STL', 'Save this rendered result into the library and link it to its OpenSCAD source.', suggested, async target => { const saved = await request(`/api/render/${state.jobId}/save`, 'POST', { target }); await refresh(); const file = state.files.find(item => item.path === saved.path); if (file) await selectFile(file); toast('Rendered STL saved and linked to its OpenSCAD source.'); }); });
action('render', async () => {
  if (!editor) return;
  const selected = state.selected, source = editor.state.doc.toString(), token = ++state.renderToken;
  $('render').disabled = true; $('export-stl').hidden = true; $('save-render').hidden = true; $('render-console').hidden = false; $('render-log').textContent = 'Starting OpenSCAD…'; viewer?.clear('Rendering model…');
  try {
    const job = await request('/api/render', 'POST', { path: selected.path, source }); state.jobId = job.id; $('cancel-render').hidden = false;
    while (token === state.renderToken) {
      await new Promise(resolve => setTimeout(resolve, 750));
      const progress = await (await api(`/api/render/${job.id}`)).json(); if (token !== state.renderToken) return;
      $('render-log').textContent = progress.log || 'OpenSCAD is working…';
      if (progress.status === 'running') continue;
      if (progress.status !== 'done') { $('render-console').open = true; throw new Error(progress.status === 'cancelled' ? 'Render cancelled.' : 'Render failed. Check OpenSCAD output below.'); }
      const result = await (await api(`/api/render/${job.id}/file`)).arrayBuffer(); if (token !== state.renderToken) return;
      viewer?.show(result, 'stl'); state.renderedSource = source; $('export-stl').href = `/api/render/${job.id}/file?download=1`; $('export-stl').hidden = false; $('save-render').hidden = !state.writable;
      $('viewer-label').textContent = editor.state.doc.toString() === source ? 'RENDERED PREVIEW' : 'PREVIEW OF EARLIER DRAFT'; toast('Render complete.'); break;
    }
  } catch (e) { if (token === state.renderToken) { viewer?.clear(e.message); toast(e.message); } }
  finally { if (token === state.renderToken) { $('render').disabled = false; $('cancel-render').hidden = true; } }
});
action('cancel-render', async () => { if (state.jobId) await request(`/api/render/${state.jobId}`, 'DELETE'); });
action('move', async () => {
  if (!await mayLeave()) return;
  await promptPath('Move or rename model', 'Enter its new path inside the library. The destination folder must exist. Moving SCAD files can break relative includes or imports.', state.selected.path, async target => { await request('/api/move', 'POST', { path: state.selected.path, target }); state.dirty = false; state.metaDirty = false; state.selected = null; await refresh(); await selectFile(state.files.find(f => f.path === target)); toast('File moved.'); });
});
action('delete-file', async () => {
  if (!state.selected || !await mayLeave()) return;
  const selected = state.selected;
  if (!confirm(`Move “${selected.name}” to the recycle bin?\n\nYou can restore it later from Settings.`)) return;
  $('delete-file').disabled = true;
  try {
    await request(`/api/file?path=${encodeURIComponent(selected.path)}`, 'DELETE');
    state.selected = null; state.dirty = false; state.metaDirty = false; viewer?.clear('Choose a model');
    $('detail').hidden = true; $('welcome').hidden = false; await refresh(); toast(`${selected.name} was moved to the recycle bin.`);
  } finally { $('delete-file').disabled = false; }
});
action('new-folder', () => promptPath('Create a folder', 'Enter a name, or a path inside an existing folder.', `${folderPrefix()}New folder`, async name => { await request('/api/folder', 'POST', { path: name }); await refresh(); setMode('folder', name); toast('Folder created.'); }));
action('new-scad', async () => {
  if (!await mayLeave()) return;
  await promptPath('New OpenSCAD model', 'Choose a filename ending in .scad. Existing files are never overwritten.', `${folderPrefix()}new-model.scad`, async name => {
    if (!name.toLowerCase().endsWith('.scad')) throw new Error('Use the .scad extension.');
    const file = new File(['// Your next print starts here.\n$fn = 64;\n\nwidth = 30;\nheight = 12;\n\ndifference() {\n    cube([width, width, height], center = true);\n    cylinder(h = height + 2, d = 10, center = true);\n}\n'], name);
    await api(`/api/upload?path=${encodeURIComponent(name)}`, { method: 'POST', body: file }); state.dirty = false; state.metaDirty = false; await refresh(); await selectFile(state.files.find(f => f.path === name));
  });
});
action('import', () => $('file-input').click());
async function importFiles(files) {
  if (!state.writable) return toast('Library files are read-only.');
  const prefix = folderPrefix(); let imported = 0; const errors = [];
  $('import').disabled = true;
  try { for (const file of files) { try { await api(`/api/upload?path=${encodeURIComponent(prefix + file.name)}`, { method: 'POST', body: file }); imported++; } catch (e) { errors.push(`${file.name}: ${e.message}`); } } await refresh(); toast(errors.length ? `${imported} imported. ${errors.join(' ')}` : `${imported} files imported.`); } finally { $('import').disabled = !state.writable; $('file-input').value = ''; }
}
$('file-input').addEventListener('change', () => importFiles([...$('file-input').files]));
$('file-list').addEventListener('dragover', event => event.preventDefault());
$('file-list').addEventListener('drop', event => { event.preventDefault(); importFiles([...event.dataTransfer.files]); });
action('dialog-cancel', () => $('path-dialog').close());
action('settings', showSettings);
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); if (!$('settings-page').hidden) { if (state.settingsDirty && !confirm('Discard unsaved settings?')) return; state.settingsDirty = false; showLibrary(); } });
action('back-library', () => { if (state.settingsDirty && !confirm('Discard unsaved settings?')) return; state.settingsDirty = false; showLibrary(); });
action('add-collection', () => { const row = collectionRow(); $('admin-collections').append(row); row.querySelector('input').focus(); markSettingsDirty(); });
action('admin-new-folder', () => promptPath('Create a library folder', 'Create a folder inside the connected library. You can select it for scanning after it is created.', 'New folder', async name => { await request('/api/folder', 'POST', { path: name }); await refresh(); await loadSettings(); toast('Library folder created.'); }));
action('bridge-pair', async () => { const response = await fetch('http://127.0.0.1:3211/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('bridge-code').value.trim() }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not pair the bridge.'); localStorage.setItem('model-manager-bridge-token', result.token); await detectSlicers(); toast('Desktop bridge paired.'); });
action('bridge-refresh', detectSlicers);
action('bridge-add-manual', async () => { const name = $('bridge-manual-name').value.trim(), path = $('bridge-manual-path').value.trim(); if (!name || !path) throw new Error('Enter both a slicer name and executable path.'); await bridgeRequest('/settings', { manualAdd: { name, path } }); await detectSlicers(); $('bridge-manual-name').value = ''; $('bridge-manual-path').value = ''; });
$('bridge-default').addEventListener('change', async () => { await bridgeRequest('/settings', { defaultPath: $('bridge-default').value }); $('bridge-status').textContent = 'Default slicer saved on this computer.'; });
const networkCredentials = () => ({ host: $('network-host').value.trim(), username: $('network-user').value, password: $('network-password').value, domain: $('network-domain').value.trim(), share: $('network-share-manual').value.trim() || $('network-share').value, folder: $('network-folder').value });
action('browse-network', async () => {
  $('network-error').textContent = ''; $('network-server').innerHTML = '<option value="">Searching for servers…</option>'; $('network-dialog').showModal();
  try { const { servers } = await (await api('/api/network/servers')).json(); $('network-server').innerHTML = `<option value="">${servers.length ? `${servers.length} servers found — choose one…` : 'No servers found — enter manually…'}</option>` + servers.map(x => { const rawIp = x.host === x.address; return `<option value="${escape(x.address || x.host)}">${rawIp ? 'SMB device' : escape(x.host)}${x.address ? ` · ${escape(x.address)}` : ''}</option>`; }).join(''); } catch (e) { $('network-error').textContent = 'Automatic discovery is unavailable. Enter the server name or IP address.'; }
});
$('network-server').addEventListener('change', () => { if ($('network-server').value) $('network-host').value = $('network-server').value; });
action('find-shares', async () => { $('network-error').textContent = 'Looking for shares…'; try { const { shares } = await request('/api/network/shares', 'POST', networkCredentials()); $('network-share').innerHTML = '<option value="">Choose a share…</option>' + shares.map(x => `<option value="${escape(x.name)}">${escape(x.name)}${x.description ? ` · ${escape(x.description)}` : ''}</option>`).join(''); $('network-error').textContent = shares.length ? '' : 'No accessible shares were returned.'; } catch (e) { $('network-error').textContent = e.message; } });
action('find-folders', async () => { $('network-error').textContent = 'Reading folders…'; try { const requestBody = networkCredentials(), current = requestBody.folder; const result = await request('/api/network/folders', 'POST', requestBody); const parent = current.includes('/') ? current.split('/').slice(0, -1).join('/') : ''; $('network-folder').innerHTML = `<option value="${escape(current)}">Use ${escape(current || 'entire share')}</option>${current ? `<option value="${escape(parent)}">↰ ${escape(parent || 'Share root')}</option>` : ''}` + result.folders.map(x => `<option value="${escape(x)}">▱ ${escape(x.split('/').at(-1))}</option>`).join(''); $('network-error').textContent = 'Select a folder and choose Browse folders again to open it, or connect to use it.'; } catch (e) { $('network-error').textContent = e.message; } });
$('network-form').addEventListener('submit', async event => { event.preventDefault(); $('network-error').textContent = 'Testing connection…'; try { const result = await request('/api/network/connect', 'POST', networkCredentials()); $('network-dialog').close(); await refresh(); await loadSettings(); toast(result.indexing ? 'Network folder connected. Indexing in the background…' : 'Network library connected.'); if (result.indexing) setTimeout(refresh, 3000); } catch (e) { $('network-error').textContent = e.message; } });
action('network-cancel', () => $('network-dialog').close());
action('disconnect-network', async () => { if (!confirm('Disconnect this SMB library? Your model files will remain on the NAS.')) return; await request('/api/network/disconnect', 'POST'); await refresh(); await loadSettings(); toast('Network library disconnected.'); });
$('settings-form').addEventListener('input', markSettingsDirty);
action('export-backup', async () => { const response = await api('/api/backup/export', { method: 'POST', body: JSON.stringify({ password: $('backup-password').value }) }); saveBlob(await response.blob(), `3d-model-manager-backup-${new Date().toISOString().slice(0, 10)}.zip`); toast($('backup-password').value ? 'Password-protected backup exported.' : 'Backup exported without SMB credentials.'); });
action('download-all-backups', async () => { const response = await api('/api/backups-download', { method: 'POST' }); saveBlob(await response.blob(), '3d-model-manager-automatic-backups.zip'); toast('Automatic backups downloaded. Store this ZIP away from the server.'); });
action('restore-backup', () => $('restore-file').click());
action('account-button', async () => { await request('/api/auth/logout', 'POST'); accountButton.hidden = true; loginDialog.showModal(); $('login-username').focus(); });
action('setup-later', () => { localStorage.setItem('setup-dismissed', '1'); setupDialog.close(); });
action('setup-connect', async () => { localStorage.setItem('setup-dismissed', '1'); setupDialog.close(); await showSettings(); $('browse-network').click(); });
action('refresh-history', loadHistory);
$('recycle-list').addEventListener('click', async event => { const restore = event.target.closest('[data-restore-recycle]'), purge = event.target.closest('[data-purge-recycle]'); if (!restore && !purge) return; try { if (restore) { await request('/api/recycle/restore', 'POST', { id: restore.dataset.restoreRecycle }); toast('File restored to its original folder.'); } else if (confirm('Permanently delete this recycled file? This cannot be undone.')) { await request('/api/recycle', 'DELETE', { id: purge.dataset.purgeRecycle }); toast('Recycled file permanently deleted.'); } await Promise.all([loadHistory(), refresh()]); } catch (error) { toast(error.message); } });
$('login-form').addEventListener('submit', async event => { event.preventDefault(); $('login-error').textContent = ''; try { await request('/api/auth/login', 'POST', { username: $('login-username').value, password: $('login-password').value }); loginDialog.close(); $('login-password').value = ''; await refresh(); if (location.hash === '#settings') await showSettings(); } catch (error) { $('login-error').textContent = error.message; } });
action('auth-add-user', async () => { await request('/api/auth/users', 'POST', { username: $('auth-username').value, password: $('auth-password').value, role: $('auth-role').value }); $('auth-username').value = ''; $('auth-password').value = ''; await loadSettings(); toast('User saved.'); });
action('auth-save', async () => { const result = await request('/api/auth/config', 'PUT', { enabled: $('auth-enabled').checked, proxyHeader: $('auth-proxy-header').value }); toast(result.enabled ? 'Sign-in is enabled.' : 'Sign-in is disabled.'); if (result.enabled) { loginDialog.showModal(); $('login-username').focus(); } });
$('auth-users').addEventListener('click', async event => { const button = event.target.closest('[data-remove-user]'); if (!button || !confirm('Remove this user?')) return; try { await request('/api/auth/users', 'DELETE', { id: button.dataset.removeUser }); await loadSettings(); toast('User removed.'); } catch (error) { toast(error.message); } });
$('restore-file').addEventListener('change', async () => { const file = $('restore-file').files[0]; if (!file) return; if (!confirm('Restore this backup? Current metadata and settings will be replaced, and a safety copy will be kept.')) { $('restore-file').value = ''; return; } try { if (file.name.toLowerCase().endsWith('.zip')) await api('/api/backup/restore', { method: 'POST', body: file, headers: { 'Content-Type': 'application/zip', 'X-Backup-Password': $('backup-password').value } }); else { const backup = JSON.parse(await file.text()); await request('/api/backup/restore', 'POST', { backup, password: $('backup-password').value }); } await refresh(); await loadSettings(); toast('Backup restored successfully, including saved images.'); } finally { $('restore-file').value = ''; } });
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('save-settings'), originalLabel = button.textContent; button.disabled = true; button.textContent = 'Saving…'; $('settings-state').textContent = 'Saving settings…';
  try {
    const collections = [...$('admin-collections').querySelectorAll('.admin-collection-name')].map(input => input.value.trim()).filter(Boolean);
    const scanFolders = state.adminSettings.scanFolders;
    const saved = await request('/api/settings', 'PUT', { collections, scanFolders, defaultSort: $('admin-sort').value, scanInterval: Number($('admin-interval').value), backupInterval: Number($('backup-interval').value), backupRetention: Number($('backup-retention').value), recycleRetention: Number($('recycle-retention').value) });
    state.settingsDirty = false; await Promise.all([refresh(), loadSettings()]); $('settings-state').textContent = saved.indexing ? 'Settings saved · Updating library in background…' : 'Settings saved'; toast(saved.indexing ? 'Settings saved. The library is updating in the background.' : 'Library settings saved.');
  } finally { button.disabled = false; button.textContent = originalLabel; }
});
action('customizer-tab', () => showEditorMode('customizer'));
action('source-tab', () => showEditorMode('source'));
for (const id of ['customizer-tab', 'source-tab']) $(id).addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const mode = event.key === 'Home' ? 'customizer' : event.key === 'End' ? 'source' : state.editorMode === 'source' ? 'customizer' : 'source'; showEditorMode(mode); $(mode === 'source' ? 'source-tab' : 'customizer-tab').focus(); } });
$('customizer').addEventListener('input', event => { const input = event.target; if (input.type === 'range') { const companion = [...$('customizer').querySelectorAll('input[type="number"]')].find(el => el.dataset.parameter === input.dataset.parameter); if (companion) companion.value = input.value; } });
$('customizer').addEventListener('change', event => {
  const input = event.target, name = input.dataset.parameter; if (!name || !editor) return;
  try {
    const source = editor.state.doc.toString(), parameter = parseParameters(source).find(p => p.name === name); if (!parameter) return;
    let value = parameter.type === 'boolean' ? input.checked : parameter.type === 'number' ? Number(input.value) : input.value;
    if ((parameter.type === 'number' || parameter.type === 'vector') && input.value.trim() === '') throw new Error('Enter a number before rendering.');
    if (parameter.type === 'vector') { value = [...parameter.value]; value[Number(input.dataset.component)] = Number(input.value); }
    const change = parameterChange(source, name, value);
    customizerUpdating = true; editor.dispatch({ changes: change }); customizerUpdating = false;
    // Keep the active field and keyboard focus while synchronizing companion values.
    for (const control of $('customizer').querySelectorAll('[data-parameter]')) if (control !== input && control.dataset.parameter === name && parameter.type === 'number') control.value = value; queueAutoRender();
  } catch (e) { customizerUpdating = false; toast(e.message); drawCustomizer(); }
});
$('customizer').addEventListener('click', event => {
  if (!editor) return;
  if (event.target.id === 'reset-parameters') { const saved = new Map(parseParameters(state.source).map(p => [p.name, p.value])); const changes = parseParameters(editor.state.doc.toString()).filter(p => saved.has(p.name)).map(p => ({ from: p.from, to: p.to, insert: JSON.stringify(saved.get(p.name)) })); editor.dispatch({ changes }); drawCustomizer(); queueAutoRender(); toast('Settings reset to saved values.'); }
  if (event.target.id === 'save-preset') { const name = prompt('Preset name:', ''); if (!name?.trim()) return; const values = Object.fromEntries(parseParameters(editor.state.doc.toString()).map(parameter => [parameter.name, parameter.value])); request('/api/presets', 'PUT', { path: state.selected.path, name, values }).then(preset => { state.selected.presets ||= {}; state.selected.presets[preset.name] = preset.values; drawCustomizer(); toast('Parameter preset saved.'); }).catch(error => toast(error.message)); }
  if (event.target.id === 'delete-preset') { const name = $('preset-choice').value; if (!name) return; request('/api/presets', 'DELETE', { path: state.selected.path, name }).then(() => { delete state.selected.presets[name]; drawCustomizer(); toast('Preset deleted.'); }).catch(error => toast(error.message)); }
});
$('customizer').addEventListener('change', event => { if (event.target.id === 'auto-render') { try { localStorage.setItem('openscad-auto-render', String(event.target.checked)); } catch {} return; } if (event.target.id === 'preset-choice') { const name = event.target.value; $('delete-preset').disabled = !name; if (!name || !editor) return; try { for (const [parameterName, value] of Object.entries(state.selected.presets?.[name] || {})) { const source = editor.state.doc.toString(), parameter = parseParameters(source).find(item => item.name === parameterName); if (parameter) editor.dispatch({ changes: parameterChange(source, parameterName, value) }); } drawCustomizer(); queueAutoRender(); toast(`Applied ${name}.`); } catch (error) { toast(error.message); } } });
action('compare-source', () => { if (!editor) return; $('source-diff').innerHTML = sourceDiff(state.source, editor.state.doc.toString()); $('compare-dialog').showModal(); });
action('close-compare', () => $('compare-dialog').close());
window.addEventListener('beforeunload', event => { if (state.dirty || state.metaDirty) { event.preventDefault(); event.returnValue = ''; } });
refresh().then(() => { if (location.hash === '#settings') showSettings(); }).catch(e => { $('banner').hidden = false; $('banner').textContent = e.message; $('connection').textContent = 'Could not connect'; });

if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController(); window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  Promise.resolve(document.modelContext.registerTool({ name: 'search_library', title: 'Search model library', description: 'Filter the visible model library by name, tags, or notes. Changes only the current view; does not modify files.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute(input) { if (!input || typeof input.query !== 'string' || input.query.length > 500) throw new Error('Provide a search query up to 500 characters.'); $('search').value = input.query; state.limit = 60; drawFiles(); return { matches: Number($('result-count').textContent), query: input.query }; } }, { signal: lifecycle.signal })).catch(() => {});
}








