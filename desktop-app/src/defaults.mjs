export var DEFAULT_PROMPT = '请分析图片中的内容。\n\n如果图片中有题目：请识别题目并解答。\n\n严格按照下面格式输出：\n\n题目：xxx\n\n<br/>\n\n<b>答案：xxx</b>\n\n不要输出多余内容。';

export var DEFAULT_SILENT_PROMPT = '请识别图片中所有完整显示的题目。只返回一个 JSON 对象，不要使用 Markdown 代码块，不要输出多余文字。\n' +
  '不要定位到题干空白、横线、输入框、解析区域或未完整显示的题目。\n' +
  '选择题必须返回正确选项本身的位置：bboxPercent 要框住正确选项行，至少包含选项字母圆圈和选项文本；coordinatePercent 要落在这个 bboxPercent 内。\n' +
  '简答题、填空题、编程题等没有可悬浮正确选项的题目，不要编造坐标，只返回答案文本，并设置 "clipboardOnly": true。\n' +
  '如果编程题已经给定了部分代码、函数签名、类定义、输入输出处理或注释要求，请在已有内容基础上补全，不要重写无关结构，不要删除题目给定的代码。\n' +
  'JSON 格式必须为：{"items":[{"questionNumber":"题号","answer":"正确答案文本","choice":"A/B/C/D 等选项字母","coordinatePercent":{"x":0到1的小数,"y":0到1的小数},"bboxPercent":{"x":0到1的小数,"y":0到1的小数,"width":0到1的小数,"height":0到1的小数}},{"questionNumber":"题号","answer":"简答/编程题答案文本","clipboardOnly":true}]}';

export function createDefaultSettings() {
  return {
    configList: [],
    customPrompt: DEFAULT_PROMPT,
    silentPrompt: DEFAULT_SILENT_PROMPT,
    uiOpacity: 0.95,
    silentModeEnabled: false,
    silentDebugFrameEnabled: false,
    silentCursorOffset: 5
  };
}
