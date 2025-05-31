let book = null;
let rendition = null;
let currentLocation = null;

const openBtn = document.getElementById('openBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const viewer = document.getElementById('viewer');

console.log('window.electronAPI:', window.electronAPI);

openBtn.onclick = async () => {
  try {
    const filePath = await window.electronAPI.openFile();
    console.log('选择的文件路径:', filePath);
    if (!filePath) {
      viewer.innerHTML = '<div style="color:red">未选择文件</div>';
      return;
    }
    const arrayBuffer = await window.electronAPI.readFile(filePath);
    console.log('arrayBuffer:', arrayBuffer);
    if (!arrayBuffer) {
      viewer.innerHTML = '<div style="color:red">文件读取失败</div>';
      return;
    }
    const u8arr = new Uint8Array(arrayBuffer);
    console.log('u8arr.length:', u8arr.length);
    const epubBlob = new Blob([u8arr], { type: 'application/epub+zip' });
    console.log('epubBlob:', epubBlob);
    if (book) book.destroy();
    if (rendition) rendition.destroy();
    try {
      book = ePub(epubBlob);
      console.log('ePub book:', book);
      rendition = book.renderTo('viewer', { width: '100%', height: '80vh' });
      rendition.display().catch(err => {
        viewer.innerHTML = '<div style="color:red">EPUB 加载失败：' + err + '</div>';
        console.error('EPUB 加载失败:', err);
      });
      rendition.on('relocated', (location) => {
        currentLocation = location;
      });
    } catch (err) {
      viewer.innerHTML = '<div style="color:red">ePub 初始化失败：' + err + '</div>';
      console.error('ePub 初始化失败:', err);
    }
  } catch (err) {
    viewer.innerHTML = '<div style="color:red">未知错误：' + err + '</div>';
    console.error('未知错误:', err);
  }
};

prevBtn.onclick = () => {
  if (rendition) rendition.prev();
};
nextBtn.onclick = () => {
  if (rendition) rendition.next();
};

function base64ToBlob(base64, mime) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mime });
} 