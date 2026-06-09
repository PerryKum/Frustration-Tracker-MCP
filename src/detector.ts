export interface DetectionResult {
  isFrustrated: boolean;
  score: number;
  signals: string[];
}

const ANGRY_PATTERNS: Array<{ pattern: RegExp; signal: string; weight: number }> = [
  { pattern: /又(来|是|搞|改)/, signal: "重复问题（又…）", weight: 2 },
  { pattern: /说了(多少|好几|多少)遍/, signal: "重复强调已说过", weight: 3 },
  { pattern: /听不懂|没听懂|理解错|搞错|弄错/, signal: "理解错误", weight: 3 },
  { pattern: /别(乱|瞎|随便)/, signal: "禁止乱来", weight: 2 },
  { pattern: /不要(改|动|加|删)/, signal: "违反不要做的约束", weight: 3 },
  { pattern: /怎么(又|还)/, signal: "再次出现同样问题", weight: 2 },
  { pattern: /废话|啰嗦|太长|简洁/, signal: "嫌啰嗦", weight: 2 },
  { pattern: /太慢|快点|赶紧|磨叽/, signal: "嫌太慢", weight: 2 },
  { pattern: /中文|简体|英文/, signal: "语言偏好", weight: 1 },
  { pattern: /[！!]{2,}/, signal: "多个感叹号", weight: 1 },
  { pattern: /[？?]{2,}/, signal: "多个问号", weight: 1 },
  { pattern: /(什么玩意|搞什么|有病|服了|无语|崩溃|气死|烦死|垃圾|废物)/, signal: "强烈负面词", weight: 3 },
  { pattern: /(不对|错了|不行|不可以|别这样)/, signal: "明确否定", weight: 2 },
  { pattern: /(你到底有没有|你到底|能不能认真)/, signal: "质疑认真程度", weight: 3 },
  { pattern: /(看(一下|看)?代码|读(一下|读)?文件|先(看|读))/, signal: "要求先看上下文", weight: 2 },
  { pattern: /\b(wrong|incorrect|no\b|stop|don't|wtf|useless|terrible|again\??)\b/i, signal: "English negative", weight: 2 },
  { pattern: /\b(I (already|just) (said|told|asked))\b/i, signal: "Already said", weight: 3 },
  { pattern: /!{2,}/, signal: "Multiple exclamation marks", weight: 1 },
];

const FRUSTRATION_THRESHOLD = 3;

export function detectFrustration(message: string): DetectionResult {
  const signals: string[] = [];
  let score = 0;

  for (const { pattern, signal, weight } of ANGRY_PATTERNS) {
    if (pattern.test(message)) {
      signals.push(signal);
      score += weight;
    }
  }

  return {
    isFrustrated: score >= FRUSTRATION_THRESHOLD,
    score,
    signals,
  };
}
