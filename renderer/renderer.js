let book = null;
let rendition = null;
let currentLocation = null;
let tocState = JSON.parse(localStorage.getItem('tocState') || '{}');
let totalPages = 0;
let currentBookKey = '';
let locationsCacheKey = '';

const openBtn = document.getElementById('openBtn');
const tocToggleBtn = document.getElementById('tocToggleBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const viewer = document.getElementById('viewer');
const tocDiv = document.getElementById('toc');
const progressSpan = document.getElementById('progress');
const fontSizeSelect = document.getElementById('fontSize');
const lineHeightSelect = document.getElementById('lineHeight');
const themeSelect = document.getElementById('theme');

console.log('window.electronAPI:', window.electronAPI);

tocToggleBtn.onclick = () => {
  if (tocDiv.style.display === 'block') {
    tocDiv.style.display = 'none';
  } else {
    tocDiv.style.display = 'block';
  }
};

// 拖拽打开文件
window.addEventListener('dragover', (e) => {
  e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
  const file = e.dataTransfer.files[0];
  if (!file.name.endsWith('.epub')) {
    alert('只支持epub文件');
    return;
  }
  // 直接用file.path
  const filePath = file.path;
  await openEpubFile(filePath);
});

// 主题样式定义
const themes = {
  light: {
    body: { background: '#fff', color: '#222' }
  },
  dark: {
    body: { background: '#181818', color: '#e6e6e6' }
  },
  sepia: {
    body: { background: '#f4ecd8', color: '#5b4636' }
  }
};

// 应用阅读样式
function applyReaderStyle() {
  if (!rendition) return;
  const fontSize = fontSizeSelect.value;
  const lineHeight = lineHeightSelect.value;
  const theme = themeSelect.value;
  rendition.themes.register('custom', {
    body: {
      ...themes[theme].body
    }
  });
  rendition.themes.select('custom');
  rendition.themes.override('font-size', fontSize);
  rendition.themes.override('line-height', lineHeight);
  // 保存设置
  localStorage.setItem('epub-reader-style', JSON.stringify({ fontSize, lineHeight, theme }));
}

// 监听控件变化
fontSizeSelect.onchange = applyReaderStyle;
lineHeightSelect.onchange = applyReaderStyle;
themeSelect.onchange = applyReaderStyle;

// 打开书后自动应用样式
function restoreReaderStyle() {
  const saved = localStorage.getItem('epub-reader-style');
  if (saved) {
    try {
      const { fontSize, lineHeight, theme } = JSON.parse(saved);
      if (fontSize) fontSizeSelect.value = fontSize;
      if (lineHeight) lineHeightSelect.value = lineHeight;
      if (theme) themeSelect.value = theme;
    } catch {}
  }
}

// 封装打开epub的主逻辑，供按钮和拖拽复用
async function openEpubFile(filePath) {
  currentBookKey = 'epub-reader-cfi-' + filePath;
  locationsCacheKey = 'epub-reader-locations-' + filePath;
  console.log('拖拽或选择的文件路径:', filePath);
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
    // 生成或加载全书分页
    progressSpan.textContent = '正在分页，请稍候...';
    let locationsData = localStorage.getItem(locationsCacheKey);
    let locationsLoaded = false;
    rendition.display().then(async () => {
      if (locationsData) {
        try {
          book.locations.load(JSON.parse(locationsData));
          totalPages = book.locations.length();
          locationsLoaded = true;
          progressSpan.textContent = '';
        } catch (e) {
          // 缓存损坏，重新生成
          locationsData = null;
        }
      }
      if (!locationsLoaded) {
        await book.locations.generate(1500);
        totalPages = book.locations.length();
        localStorage.setItem(locationsCacheKey, JSON.stringify(book.locations.save()));
        progressSpan.textContent = '';
      }
      // 跳转到上次阅读位置，只跳转一次
      const lastCfi = localStorage.getItem(currentBookKey);
      let hasJumped = false;
      if (lastCfi) {
        hasJumped = true;
        rendition.display(lastCfi);
      }
      rendition.on('relocated', (location) => {
        currentLocation = location;
        updateProgress(location);
        // 保存当前位置
        if (location && location.start && location.start.cfi) {
          localStorage.setItem(currentBookKey, location.start.cfi);
        }
        // 如果未跳转过且有lastCfi，首次 relocated 时跳转
        if (!hasJumped && lastCfi) {
          hasJumped = true;
          rendition.display(lastCfi);
        }
      });
      // 首次显示进度
      updateProgress(rendition.location);
    });
    // 加载目录
    book.loaded.navigation.then(nav => {
      renderTOC(nav.toc);
      tocDiv.style.display = 'block'; // 只在打开新书时显示目录
    });
    // 应用阅读样式
    restoreReaderStyle();
    applyReaderStyle();
  } catch (err) {
    viewer.innerHTML = '<div style="color:red">ePub 初始化失败：' + err + '</div>';
    console.error('ePub 初始化失败:', err);
  }
}

// 修改按钮打开逻辑为复用openEpubFile
openBtn.onclick = async () => {
  const filePath = await window.electronAPI.openFile();
  if (filePath) {
    await openEpubFile(filePath);
  }
};

function updateProgress(location) {
  if (!location || !book || !rendition || !book.locations) {
    progressSpan.textContent = '';
    return;
  }
  // 当前页码
  let currentPage = 1;
  if (location && location.start && location.start.cfi) {
    currentPage = book.locations.locationFromCfi(location.start.cfi) + 1;
  } else if (location && location.cfi) {
    currentPage = book.locations.locationFromCfi(location.cfi) + 1;
  }
  // 总页数
  let total = totalPages || book.locations.length();
  // 百分比
  let percent = total > 0 ? Math.round((currentPage / total) * 1000) / 10 : 0;
  progressSpan.textContent = `进度：第${currentPage}页 / 共${total}页 (${percent}%)`;
}

function renderTOC(toc, parentPath = '') {
  if (!toc || toc.length === 0) {
    tocDiv.style.display = 'none';
    return;
  }
  tocDiv.innerHTML = '<h4 style="margin:10px 0 10px 10px;">目录</h4>';
  const ul = document.createElement('ul');
  ul.style.listStyle = 'none';
  ul.style.padding = '0 0 0 10px';
  toc.forEach((item, idx) => {
    const li = document.createElement('li');
    const itemPath = parentPath + '/' + idx;
    const hasSub = item.subitems && item.subitems.length > 0;
    // 目录项内容span
    const labelSpan = document.createElement('span');
    labelSpan.textContent = item.label;
    labelSpan.title = item.label;
    labelSpan.style.display = 'inline-block';
    labelSpan.style.width = 'calc(100% - 20px)';
    labelSpan.style.verticalAlign = 'middle';
    labelSpan.style.cursor = 'pointer';
    labelSpan.onclick = (e) => {
      e.stopPropagation();
      if (rendition && item.href) {
        rendition.display(item.href);
      }
    };
    li.appendChild(labelSpan);
    if (hasSub) {
      li.classList.add('toc-expandable');
      if (tocState[itemPath] !== false) {
        li.classList.add('toc-expanded');
      } else {
        li.classList.add('toc-collapsed');
      }
      li.onclick = (e) => {
        if (e.target !== li) return;
        const expanded = li.classList.toggle('toc-expanded');
        li.classList.toggle('toc-collapsed', !expanded);
        tocState[itemPath] = expanded;
        localStorage.setItem('tocState', JSON.stringify(tocState));
      };
    }
    ul.appendChild(li);
    if (hasSub) {
      const subUl = renderTOCSub(item.subitems, itemPath);
      li.appendChild(subUl);
      if (tocState[itemPath] === false) {
        subUl.style.display = 'none';
      }
    }
  });
  tocDiv.appendChild(ul);
}

function renderTOCSub(subitems, parentPath) {
  const subUl = document.createElement('ul');
  subUl.style.listStyle = 'none';
  subUl.style.paddingLeft = '16px';
  subitems.forEach((sub, idx) => {
    const subLi = document.createElement('li');
    const subPath = parentPath + '/' + idx;
    const labelSpan = document.createElement('span');
    labelSpan.textContent = sub.label;
    labelSpan.title = sub.label;
    labelSpan.style.display = 'inline-block';
    labelSpan.style.width = 'calc(100% - 20px)';
    labelSpan.style.verticalAlign = 'middle';
    labelSpan.style.cursor = 'pointer';
    labelSpan.onclick = (e) => {
      e.stopPropagation();
      if (rendition && sub.href) {
        rendition.display(sub.href);
      }
    };
    subLi.appendChild(labelSpan);
    if (sub.subitems && sub.subitems.length > 0) {
      subLi.classList.add('toc-expandable');
      if (tocState[subPath] !== false) {
        subLi.classList.add('toc-expanded');
      } else {
        subLi.classList.add('toc-collapsed');
      }
      subLi.onclick = (e) => {
        if (e.target !== subLi) return;
        const expanded = subLi.classList.toggle('toc-expanded');
        subLi.classList.toggle('toc-collapsed', !expanded);
        tocState[subPath] = expanded;
        localStorage.setItem('tocState', JSON.stringify(tocState));
      };
    }
    subUl.appendChild(subLi);
    if (sub.subitems && sub.subitems.length > 0) {
      const subSubUl = renderTOCSub(sub.subitems, subPath);
      subLi.appendChild(subSubUl);
      if (tocState[subPath] === false) {
        subSubUl.style.display = 'none';
      }
    }
  });
  return subUl;
}

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

// 键盘快捷键：左右方向键/PageUp/PageDown 翻页
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    if (rendition) rendition.prev();
    e.preventDefault();
  } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
    if (rendition) rendition.next();
    e.preventDefault();
  }
}); 