export interface DetectionResult {
  isFrustrated: boolean;
  score: number;
  signals: string[];
}

/** 命中任一条即判定为挫败（辱骂、脏话、人身攻击） */
const CRITICAL_PATTERNS: Array<{ pattern: RegExp; signal: string }> = [
  { pattern: /傻[逼叉比屄]|煞笔|沙比|沙雕(?=你|这|那)|\bsb\b|\bSB\b/i, signal: "辱骂（傻×/SB）" },
  { pattern: /[操艹草泥]|cnm|cnmb|tmd|TMD|nmd|NMD|nmsl|NMSL|wdnmd|WTF|wtf/i, signal: "脏话/咒骂" },
  { pattern: /你妈|你马|你妹|去死|弄死你|杀了你|狗[日比东西]|畜生|杂种|贱[人货]|婊子|贱种/, signal: "人身攻击" },
  { pattern: /脑残|智障|弱智|白痴|蠢[货猪驴]|低能|没脑子|没脑子吗|脑子有[病坑]|精神病/, signal: "侮辱智力" },
  { pattern: /\b(fuck|fucking|fucked|shit|bitch|asshole|bastard|damn|idiot|moron|dumbass|retard)\b/i, signal: "English profanity/insult" },
  { pattern: /\b(go to hell|shut up|stupid bot|useless bot|you suck)\b/i, signal: "English hostile" },
  { pattern: /滚[开蛋]?|闭嘴|别[废bb]话|够了[！!]?$|受够了/, signal: "驱赶/拒绝对话" },
  { pattern: /(什么|这)[玩意东西]+[？?]?$|有[屁病]吧|是不是[有]?病|脑子呢/, signal: "强烈轻蔑" },
];

const ANGRY_PATTERNS: Array<{ pattern: RegExp; signal: string; weight: number }> = [
  { pattern: /又(来|是|搞|改)/, signal: "重复问题（又…）", weight: 2 },
  { pattern: /说了(多少|好几|多少)遍/, signal: "重复强调已说过", weight: 3 },
  { pattern: /听不懂|没听懂|理解错|搞错|弄错/, signal: "理解错误", weight: 3 },
  { pattern: /别(乱|瞎|随便)/, signal: "禁止乱来", weight: 2 },
  { pattern: /不要(改|动|加|删)/, signal: "违反不要做的约束", weight: 3 },
  { pattern: /怎么(又|还)/, signal: "再次出现同样问题", weight: 2 },
  { pattern: /废话|啰嗦|太长|简洁点/, signal: "嫌啰嗦", weight: 2 },
  { pattern: /太慢|快点|赶紧|磨叽/, signal: "嫌太慢", weight: 2 },
  { pattern: /[！!]{2,}/, signal: "多个感叹号", weight: 2 },
  { pattern: /[？?]{2,}/, signal: "多个问号", weight: 1 },
  {
    pattern: /(什么玩意|搞什么|有病|服了|无语|崩溃|气死|烦死|垃圾|废物|坑|烂|差劲|离谱|胡说)/,
    signal: "强烈负面词",
    weight: 3,
  },
  { pattern: /(不对|错了|不行|不可以|别这样|不对吧)/, signal: "明确否定", weight: 2 },
  { pattern: /(你到底有没有|你到底|能不能认真|会不会|会不会啊)/, signal: "质疑能力/认真程度", weight: 3 },
  { pattern: /(看(一下|看)?代码|读(一下|读)?文件|先(看|读))/, signal: "要求先看上下文", weight: 2 },
  { pattern: /\b(wrong|incorrect|no\b|stop|don't|useless|terrible|awful|horrible|again\??)\b/i, signal: "English negative", weight: 2 },
  { pattern: /\b(I (already|just) (said|told|asked))\b/i, signal: "Already said", weight: 3 },
  { pattern: /(呵呵|笑死|真行|真厉害|挺你|可真有你的)/, signal: "讽刺/反语", weight: 2 },
  { pattern: /(能不能|到底|为什么还|为何还).{0,12}(不|没|又)/, signal: "质问式不满", weight: 2 },
];

const FRUSTRATION_THRESHOLD = 2;

export function detectFrustration(message: string): DetectionResult {
  const signals: string[] = [];
  let score = 0;

  for (const { pattern, signal } of CRITICAL_PATTERNS) {
    if (pattern.test(message)) {
      signals.push(signal);
      score += 5;
    }
  }

  for (const { pattern, signal, weight } of ANGRY_PATTERNS) {
    if (pattern.test(message)) {
      if (!signals.includes(signal)) signals.push(signal);
      score += weight;
    }
  }

  const hasCritical = score >= 5;

  return {
    isFrustrated: hasCritical || score >= FRUSTRATION_THRESHOLD,
    score,
    signals,
  };
}
