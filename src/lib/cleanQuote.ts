/** 清理台词文本中的引号冲突：
 *  - 去掉 "经典台词" 等标签前缀
 *  - 去掉首尾悬空引号（装饰引号由样式承担）
 *  - 去掉中文语境里夹在文字中间的多余引号（如 "公主！" 那声呼唤） */
export function cleanQuoteText(raw: string): string {
  let t = (raw || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^经典台词\s*[：:]\s*/, '').replace(/^台词\s*[：:]\s*/, '');
  // 去掉板块标签前缀（如 OFFER " ...）
  t = t.replace(/^[A-Z][A-Z0-9 _-]{1,20}\s*["“”]\s*/, '');
  t = t.replace(/^["“”'‘]+/, '').replace(/["“”'‘]+$/, '');
  // 中文标点后紧跟悬空引号（前后英文或中文）→ 去掉引号保留文字
  t = t.replace(/([\u4e00-\u9fff，。！？：；、）】])\s*["“”]\s*/g, '$1 ');
  // 中文文字前悬空的引号（英文引号包裹中文时保留外层语义）→ 去掉
  t = t.replace(/\s*["“”]\s*([\u4e00-\u9fff（【])/g, ' $1');
  return t.replace(/\s{2,}/g, ' ').trim();
}
