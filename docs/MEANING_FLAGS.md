# Core meanings to check

Found while reviewing the 高考 Tatoeba candidates (2026-10-25). In each case
the natural example sentences used another sense than the card's core
meaning, so the example was **rejected** rather than shown next to a meaning
it does not illustrate. Nothing here has been changed in the dictionary.

**How to use this list.** Check each word against a learner's dictionary.
Correct it in `server/dictionary_overrides.json` (the `meaning` section) only
after that check, then rebuild. The candidate sheet
(`.ai-work/tatoeba/gk-candidates.tsv`) still has the rejected pair, which can
be reviewed again once the meaning is fixed.

The "Common sense" column is a reviewer's suggestion, not a verified fix.

| Word | Current core meaning | Source | Common sense seen in the examples |
| --- | --- | --- | --- |
| authentic | a. 可靠的, 可信的 | single | 真正的, 地道的 |
| awesome | a. 引起敬畏的, 可怕的 | single | 很棒的 (informal); 令人敬畏的 |
| canteen | n. 水壶, 军中俱乐部 | single | 食堂 |
| channel | n. 海峡, 航道 | wordnet | 频道; 渠道 |
| click | vi. 作咔哒声 | wordnet | 点击 |
| contemporary | a. 同时代的, 属于同一时期的 | wordnet | 当代的 |
| counter | n. 计算器, 计算者 | wordnet | 柜台 |
| fairness | n. 晴朗, 光明正大 | single | 公平 |
| function | n. 官能, 职务 | wordnet | 功能; 函数 |
| gallery | n. 走廊, 最高楼座 | single | 画廊, 美术馆 |
| heroine | n. 巾帼英雄, 烈妇 | single | 女主角; 女英雄 |
| institute | vt. 创立, 开始 | wordnet | n. 学院, 研究所 |
| interpreter | n. 直译程序, 解释者 | single | 口译员, 译员 |
| maid | n. 少女, 未婚女子 | single | 女佣 |
| performance | n. 施行, 工作情况 | single | 表演; 表现 |
| rail | n. 横杆, 围栏 | wordnet | 铁轨, 铁路 |
| scholarship | n. 学问, 学术成就 | single | 奖学金 |
| sneaker | n. 鬼鬼祟祟做事的人, 卑鄙者 | single | 运动鞋 (usually "sneakers") |
| tissue | n. 薄的织物, 薄纱 | single | 组织 (biology); 纸巾 |

**Pattern.** Most are `single` (ECDICT has one part of speech, and its first
glosses are kept) or `wordnet`. ECDICT often lists an older or narrower gloss
first. A meaning-check pass over high-frequency `single` words would likely
find more of these.
