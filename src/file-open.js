// Explain accidental file:// opens before showing an unusable app shell.
if (window.location.protocol === 'file:') {
  window.addEventListener('DOMContentLoaded', () => {
    document.body.replaceChildren();
    Object.assign(document.body.style, { margin: '0', padding: '64px 24px', background: '#111821', color: '#e8edf3', fontFamily: 'system-ui, sans-serif', lineHeight: '1.6' });
    const panel = document.createElement('main');
    Object.assign(panel.style, { maxWidth: '580px', margin: '0 auto' });
    const title = document.createElement('h1'); title.textContent = 'Open 3D Model Manager through its server';
    const message = document.createElement('p'); message.textContent = 'You opened a source file. 3D Model Manager needs its running server to load the interface, model library, and OpenSCAD renderer.';
    const link = document.createElement('a'); link.href = 'http://127.0.0.1:3210/'; link.textContent = 'Open the local 3D Model Manager app';
    Object.assign(link.style, { display: 'inline-block', padding: '12px 18px', margin: '16px 0', background: '#ef9e49', color: '#111821', borderRadius: '8px', textDecoration: 'none', fontWeight: '600' });
    const note = document.createElement('p'); note.textContent = 'For the Docker installation, use your OMV server’s IP address and configured port instead. The local link works while the app is running on this computer.';
    panel.append(title, message, link, note); document.body.append(panel);
  });
}
