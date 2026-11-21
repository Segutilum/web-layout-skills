export const PALETTE = [
  { type: 'heading', label: '标题', container: false },
  { type: 'paragraph', label: '段落', container: false },
  { type: 'buttons', label: '按钮组', container: false },
  { type: 'image', label: '图片', container: false },
  { type: 'cards', label: '卡片组', container: false },
  { type: 'columns-2', label: '两栏', container: true },
  { type: 'columns-3', label: '三栏', container: true },
  { type: 'divider', label: '分隔线', container: false },
  { type: 'section', label: '区块', container: true },
];

export const PALETTE_TYPES = new Set(PALETTE.map((item) => item.type));
export const CONTAINER_TYPES = new Set(PALETTE.filter((item) => item.container).map((item) => item.type));
