// Where a FoxLens sentence came from (capture.kind in the Lens export)
const SOURCE_LABEL = { selection: "选中文字", ocr: "屏幕截图", audio: "音频", subtitles: "字幕", text: "文本", image: "图片" };

export const sourceLabel = (kind) => SOURCE_LABEL[kind] || kind || "FoxLens";
