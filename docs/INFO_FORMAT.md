# Skland Wiki Info JSON 格式说明

本文档基于对 `D:\data\skland\info` 的实际数据扫描整理，用于后续重写「Wiki -> JEI Web 提取逻辑」。

## 1. 数据集概况

- 扫描时间: 2026-02-14
- 根目录: `D:\data\skland\info`
- 文件总数: 1063 个 JSON
- `index.json` 中可用条目: 1062（均可解析）
- 主分类: `终末地百科` / `情报档案库` / `游戏攻略辑`

## 2. 目录与索引

`index.json` 结构:

```json
{
  "files": [
    {
      "itemId": "1",
      "id": "1",
      "name": "id1.json",
      "path": "终末地百科/威胁/id1.json",
      "categoryPath": "终末地百科/威胁",
      "mainId": "1",
      "mainName": "终末地百科",
      "subId": "3",
      "subName": "威胁",
      "exists": true
    }
  ]
}
```

字段说明:

- `path`: 相对 `info` 根目录的文件路径。
- `mainName/subName`: 分类标签，可用于默认打标。
- `exists`: 当前抓取结果是否存在文件。

## 3. 单个 Wiki 文件总体结构

1062/1062 文件都满足如下顶层形态:

```json
{
  "code": 0,
  "message": "OK",
  "timestamp": "1770648703",
  "data": {
    "item": { ... }
  }
}
```

## 4. `data.item` 字段

所有文件都包含下列字段:

- `itemId`, `name`
- `document`
- `mainType`, `subType`
- `brief`
- `lang`, `lastUpdatedUser`, `createdUser`, `status`, `publishedAtTs`, `lastAuditPassedAt`, `tagIds`

### 4.1 `brief`

固定字段:

- `cover`
- `name`
- `description`（是文档对象，不是纯文本）
- `associate`
- `subTypeList`
- `composite`

### 4.2 `mainType/subType`

- `mainType`: `id/name/status/position/typeSub`
- `subType`: `id/name/fatherTypeId/style/status/position/icon/items/filterTagTree`
- `filterTagTree` 在 969 个条目非空。

## 5. `item.document` 文档模型

所有文件都有以下 4 个键:

- `documentMap`
- `chapterGroup`
- `extraInfo`
- `widgetCommonMap`

### 5.1 `documentMap`

- 1060 个条目非空，2 个为空。
- `documentMap[docId]` 结构:
  - `id`, `blockIds`, `blockMap`, `authorMap`, `version`

### 5.2 `chapterGroup`

- 1060 个条目非空。
- 每章结构:
  - `title`
  - `widgets`: `[{ id, title, size }]`

### 5.3 `widgetCommonMap`

- 1060 个条目非空。
- `widgetCommonMap[widgetId]` 类型分布:
  - `common`: 3105
  - `table`: 24
  - `audio`: 7

每个 widget 统一含有:

- `type`
- `tableList`
- `tabList`
- `tabDataMap`

`tabDataMap[tabId]` 统一字段:

- `intro`
- `content`（指向 `documentMap` 文档 ID）
- `audioList`

`intro`（存在时）:

- `name`
- `type`
- `imgUrl`
- `description`（也可指向 `documentMap` 文档 ID）

## 6. 文档块结构（`documentMap[].blockMap`）

块类型统计:

- `text`: 59152
- `horizontalLine`: 5105
- `table`: 2708
- `list`: 1565
- `image`: 690
- `quote`: 94

### 6.1 `text` 块

`text.kind` 仅出现:

- `body`
- `heading2`
- `heading3`

`inlineElements[].kind` 分布:

- `text`
- `entry`
- `link`
- `pronunciation`

#### `entry` 内联（最关键）

结构:

```json
{ "kind": "entry", "entry": { "id": "897", "showType": "link-imgText", "count": "2" } }
```

说明:

- `entry.id`: 关联物品 ID（需要映射到 pack item id）。
- `entry.count`: 数量字符串，常见 `"0"`（表示引用/链接，不是产量）。
- `entry` 是“来源/用途/配方关系”提取的核心信号。

### 6.2 其它块

- `list`: 通过 `itemMap[itemId].childIds` 指向子块。
- `table`: 单元格 `cellMap[row_col].childIds` 继续指向子块。
- `quote`: `childIds` 指向子块。
- `image`: 含 `url/width/height/description/...`。

注意: `entry` 只出现在文本内联里，但文本可能嵌在 `list/table/quote` 的子树内，因此提取时必须遍历整棵 block 树。

## 7. 与“获取方式/用途/配方”相关的语义线索

这一节改为“片段级分析”，重点描述你列出的章节/组件在真实数据中的格式。

### 7.1 章节-组件映射关系（全量）

你给的 5 个章节标题和 5 个组件标题在数据里不是一一对应，存在“同语义但不同组件名”的情况。

| 章节标题 | 条目数 | 主要组件标题（计数） |
| --- | ---: | --- |
| `物品来源` | 345 | `相关来源` (343), `野外采集` (1), 空标题 (1) |
| `物品用途` | 374 | `相关用途` (374) |
| `参与配方` | 170 | `简易制作` (104), `工业合成` (81), `基核提取` (14), `物品配方` (1) |
| `获取方式` | 60 | `所属区域` (60) |
| `使用方式` | 53 | `相关信息` (53), `面积需求` (53), `相关配方` (18) |

关键点:

- 只匹配你列的 5 个组件标题会漏掉:
  - `获取方式` -> `所属区域`
  - `参与配方` -> `基核提取` / `物品配方`
  - `使用方式` -> `相关信息` / `面积需求`

### 7.2 片段画像（你列的 10 类目标）

以下统计基于对应章节/组件能解析到的文档片段（`tabDataMap.content` + `intro.description`）。

| 目标 | 片段数 | entry 总数 | 非零 entry | 典型结构 |
| --- | ---: | ---: | ---: | --- |
| `chapter:物品来源` | 345 | 528 | 328 | `text + list` 为主，少量 `table` |
| `chapter:物品用途` | 374 | 592 | 474 | `text + list`，中等比例 `table` |
| `chapter:参与配方` | 219 | 1694 | 1437 | 几乎全是 `table` 配方片段 |
| `chapter:获取方式` | 120 | 0 | 0 | 纯 `text/list`，无 `entry` |
| `chapter:使用方式` | 124 | 345 | 311 | 说明文本 + 部分配方表 |
| `widget:相关来源` | 343 | 527 | 328 | 与 `物品来源` 基本同构 |
| `widget:相关用途` | 374 | 592 | 474 | 与 `物品用途` 基本同构 |
| `widget:简易制作` | 105 | 685 | 681 | 标准 3 列配方表 |
| `widget:工业合成` | 101 | 968 | 714 | 标准 3 列配方表（含机器列） |
| `widget:相关配方` | 26 | 372 | 338 | 设备页配方表，含耗时 |

### 7.3 配方类片段格式（重点）

#### A. `简易制作`

主模板（103/105）:

`制作类型 | 原料需求 | 制作产物`

主尺寸:

- `2x3` (71)
- `3x3` (11)
- `4x3` (8)

典型片段:

```text
| 制作类型 | 原料需求 | 制作产物 |
| 精制食药 | [[entry:35x1]][[entry:137x1]] [[entry:370x1]] | [[entry:20x1]] |
```

#### B. `工业合成`

主模板:

- `合成设备 | 原料需求 | 合成产物` (83)
- 少量变体: `制作设备 | 原料需求 | 合成产物`、`合成设备 | 需求原料 | 合成产物`

主尺寸:

- `2x3` (28)
- `3x3` (22)
- `4x3` (17)

典型片段:

```text
| 合成设备 | 原料需求 | 合成产物 |
| [[entry:54x0]] | [[entry:193x1]] | [[entry:29x1]] |
| [[entry:53x0]] | [[entry:29x1]] | [[entry:193x1]] |
```

说明:

- 机器经常以 `entry.count=0` 出现（表示“设备引用”，不是产量）。
- 原料和产物通常是 `count>0`。

#### C. `相关配方`（设备页）

主模板:

- `原料需求 | 制作产物 | 消耗时长` (18)
- 少量 `制作类型 | 原料需求 | 制作产物` (9)

高频关键词:

- `耗时` (23)
- `消耗` (23)

典型片段:

```text
精炼炉支持以下合成配方。
| 原料需求 | 制作产物 | 消耗时长 |
| [[entry:205x1]] | [[entry:194x1]] | 2s |
```

#### D. `参与配方`（章节）

这是“配方聚合章节”，会混合 `简易制作`/`工业合成` 两类表头:

- `制作类型 | 原料需求 | 制作产物` (103)
- `合成设备 | 原料需求 | 合成产物` (82)

因此如果只按章节名提取，仍需在片段内做“表头二次分类”。

### 7.4 来源/用途类片段格式

#### A. `物品来源` / `相关来源`

常见结构:

- 描述段 + 列表
- 列表项中混合纯文本与 `entry`
- 少量数据表（奖励/等级/概率类）

典型片段:

```text
采购中心 - 信用交易所获取。
- 每日固定奖励 [[entry:16x300]]
- 生产助力每次获取 [[entry:16x20]]
```

#### B. `物品用途` / `相关用途`

常见结构:

- 用途说明文本
- 有些条目包含“消耗/概率/阶段”表
- `entry` 多用于“消耗成本”表达

#### C. `获取方式`（章节）

重要特征:

- 在当前数据里对应组件是 `所属区域`，不是 `相关来源`。
- 片段基本是“区域 + 掉落描述”的文本列表，无 `entry`。

典型片段:

```text
- 能量淤积点
- 敌人掉落
```

### 7.5 对提取器的直接约束

- 不能把“来源”只绑定到 `相关来源`，还要覆盖 `获取方式 -> 所属区域`。
- 不能把“配方”只绑定到 `工业合成/简易制作`，还要覆盖 `使用方式 -> 相关配方`。
- 配方识别优先看表头语义，不只看章节名。
- 解析 `entry` 时建议区分:
  - `count=0`: 引用/设备
  - `count>0`: 实际数量
- 仍需全量遍历 `tabDataMap.content` + `intro.description`，避免漏片段。

### 7.6 逐类型详细样例库（10 类）

以下每类都给出“定位路径 + 结构参考 + 真实片段 + 更多样本”。

#### 7.6.1 `chapter:物品来源`

示例文件: `D:\data\skland\info\终末地百科\物品\id16.json`（信用）

定位路径:

```text
item.document.chapterGroup[title="物品来源"]
-> widgets[title="相关来源"]
-> widgetCommonMap[widgetId].tabDataMap.default.content = "Sg64AZ5S"
-> documentMap["Sg64AZ5S"]
```

结构参考:

```json
{
  "chapterTitle": "物品来源",
  "widgetTitle": "相关来源",
  "widgetType": "common",
  "tabDataMap": {
    "default": { "intro": null, "content": "Sg64AZ5S", "audioList": [] }
  }
}
```

真实片段:

```text
采购中心 - 信用交易所获取。
- 每日凌晨 4:00 后可以在信用交易所获取每日固定奖励[[entry:16x300]]
帝江号-生产助力与物资调度终端。
```

更多样本: `id14.json`, `id17.json`, `id18.json`, `id19.json`

#### 7.6.2 `chapter:物品用途`

示例文件: `D:\data\skland\info\终末地百科\物品\id16.json`（信用）

定位路径:

```text
chapterGroup[title="物品用途"]
-> widgets[title="相关用途"]
-> tabDataMap.default.content = "lvsJAfhc"
```

结构参考:

```json
{
  "chapterTitle": "物品用途",
  "widgetTitle": "相关用途",
  "widgetType": "common",
  "docBlockKinds": ["horizontalLine", "text", "list"]
}
```

真实片段:

```text
采购中心 - 信用交易所购买物品。
- 每名玩家每日仅能进行4次刷新，首次刷新花费[[entry:16x80]]
```

更多样本: `id14.json`, `id17.json`, `id18.json`, `id20.json`

#### 7.6.3 `chapter:参与配方`

该章节是“配方聚合章”，常见多个组件并存。

示例 A（简易制作）文件: `D:\data\skland\info\终末地百科\物品\id20.json`

```text
chapterGroup[title="参与配方"] -> widget="简易制作" -> content="g3bjc8s7"
```

```text
| 制作类型 | 原料需求 | 制作产物 |
| 精制食药 | [[entry:35x1]][[entry:137x1]] [[entry:370x1]] | [[entry:20x1]] |
```

示例 B（工业合成）文件: `D:\data\skland\info\终末地百科\物品\id29.json`

```text
chapterGroup[title="参与配方"] -> widget="工业合成" -> content="SbIKJVjG"
```

```text
| 合成设备 | 原料需求 | 合成产物 |
| [[entry:54x0]] | [[entry:193x1]] | [[entry:29x1]] |
```

更多样本: `id21.json`, `id22.json`, `id23.json`, `id31.json`, `id33.json`

#### 7.6.4 `chapter:获取方式`

示例文件: `D:\data\skland\info\终末地百科\武器基质\id143.json`（稳定基质）

定位路径:

```text
chapterGroup[title="获取方式"]
-> widgets[title="所属区域"]
-> tabDataMap["tab_..."].content
```

结构参考:

```json
{
  "chapterTitle": "获取方式",
  "widgetTitle": "所属区域",
  "widgetType": "common",
  "tabList": ["四号谷地", "武陵"],
  "docBlockKinds": ["list"]
}
```

真实片段:

```text
- 能量淤积点
- 敌人掉落
```

更多样本: `id328.json`, `id329.json`, `id330.json`, `id422.json`

#### 7.6.5 `chapter:使用方式`

该章节不是纯配方，通常由 `相关信息` + `面积需求` +（部分条目）`相关配方` 组成。

示例 A（说明文本）文件: `D:\data\skland\info\终末地百科\设备\id10.json`

```text
chapterGroup[title="使用方式"] -> widget="相关信息" -> content="5f9QPZmW"
```

```text
物品准入口是物流类型的机器，可限制传送带上允许通过的物品。
可通过物品准入口限制通过物品的数量...
```

示例 B（设备配方）文件: `D:\data\skland\info\终末地百科\设备\id53.json`

```text
chapterGroup[title="使用方式"] -> widget="相关配方" -> content="0o88XJd4"
```

```text
| 原料需求 | 制作产物 | 消耗时长 |
| [[entry:205x1]] | [[entry:194x1]] | 2s |
```

更多样本: `id50.json`, `id54.json`, `id55.json`, `id161.json`

#### 7.6.6 `widget:相关来源`

示例文件: `D:\data\skland\info\终末地百科\物品\id16.json`

定位路径:

```text
widgetCommonMap["JRRTRIUi"] (title="相关来源")
-> tabDataMap.default.content = "Sg64AZ5S"
```

结构参考:

```json
{
  "type": "common",
  "tabList": [],
  "tabDataMap": {
    "default": { "intro": null, "content": "Sg64AZ5S", "audioList": [] }
  }
}
```

真实片段与 `chapter:物品来源` 同源（来源说明 + 列表 + entry）。

#### 7.6.7 `widget:相关用途`

示例文件: `D:\data\skland\info\终末地百科\物品\id16.json`

定位路径:

```text
widgetCommonMap["BrfRWXDB"] (title="相关用途")
-> tabDataMap.default.content = "lvsJAfhc"
```

结构参考:

```json
{
  "type": "common",
  "tabDataMap": {
    "default": { "intro": null, "content": "lvsJAfhc", "audioList": [] }
  }
}
```

真实片段与 `chapter:物品用途` 同源（用途说明 + 消耗类 entry）。

#### 7.6.8 `widget:工业合成`

示例文件: `D:\data\skland\info\终末地百科\物品\id29.json`

定位路径:

```text
widgetCommonMap["ZQxNP3i5"] (title="工业合成")
-> tabDataMap.default.content = "SbIKJVjG"
```

结构参考:

```json
{
  "type": "common",
  "docBlockKinds": ["table", "horizontalLine"],
  "tableHeader": ["合成设备", "原料需求", "合成产物"]
}
```

真实片段:

```text
| 合成设备 | 原料需求 | 合成产物 |
| [[entry:54x0]] | [[entry:193x1]] | [[entry:29x1]] |
```

补充: 机器列经常出现 `count=0` 的 `entry`，应按设备引用处理。

#### 7.6.9 `widget:简易制作`

示例文件: `D:\data\skland\info\终末地百科\物品\id20.json`

定位路径:

```text
widgetCommonMap["mRBEdn8A"] (title="简易制作")
-> tabDataMap.default.content = "g3bjc8s7"
```

结构参考:

```json
{
  "type": "common",
  "docBlockKinds": ["table", "horizontalLine"],
  "tableHeader": ["制作类型", "原料需求", "制作产物"]
}
```

真实片段:

```text
| 制作类型 | 原料需求 | 制作产物 |
| 精制食药 | [[entry:35x1]][[entry:137x1]] [[entry:370x1]] | [[entry:20x1]] |
```

#### 7.6.10 `widget:相关配方`

示例文件: `D:\data\skland\info\终末地百科\设备\id53.json`（精炼炉）

定位路径:

```text
widgetCommonMap["Yx5BD6yN"] (title="相关配方")
-> tabDataMap.default.content = "0o88XJd4"
```

结构参考:

```json
{
  "type": "common",
  "docBlockKinds": ["text", "table", "horizontalLine"],
  "tableHeader": ["原料需求", "制作产物", "消耗时长"]
}
```

真实片段:

```text
精炼炉支持以下合成配方。
| 原料需求 | 制作产物 | 消耗时长 |
| [[entry:205x1]] | [[entry:194x1]] | 2s |
```

更多样本: `id54.json`, `id55.json`, `id166.json`

## 8. 边界样例

2 个条目没有 `documentMap/chapterGroup/widgetCommonMap` 内容:

- `终末地百科/物品/id15.json`（通行证经验）
- `终末地百科/贵重品库/id867.json`（醚质晶块）

它们的内容在 `brief.description` 文档里。提取逻辑需要把 `brief.description` 作为回退数据源。

## 9. 与 AEF 机器配方结构对齐建议

参考 `public/packs/aef/recipeTypes.json` 与 `public/packs/aef/recipes.json`:

- 机器配方类型使用 `renderer: "slot_layout"`。
- `recipeTypes[].slots` 应按真实输入输出数量定义固定槽位。
- `recipeTypes[].paramSchema` 常见包含:
  - `time`
  - `usage`
  - `cost`
- `recipeTypes[].defaults` 可包含机器默认开销参数（如 `power/speed/moduleSlots/beaconSlots`）。

对当前 skland 构建器的建议:

- 机器类型槽位不要简单按全局最大值铺开。
- 应按“同机器类型的真实最大输入/输出”并参考 AEF 的紧凑布局规则。
- 若后续接入传送带/功耗参数，可扩展 `paramSchema/defaults` 对齐 AEF 的写法。

## 10. 重写提取器前的最小规则集

- 规则 1: 从 `index.json.files` 驱动遍历。
- 规则 2: 解析主文档来源为 `documentMap` + `widgetCommonMap` + `chapterGroup`。
- 规则 3: 对每个 widget，遍历 `tabDataMap` 的 `content` 与 `intro.description`。
- 规则 4: 对每个文档执行递归遍历，提取所有 `entry(id,count)`。
- 规则 5: 将关系按语义分类:
  - 来源类: `来源/获取/掉落/采集...`
  - 用途类: `用途/使用/消耗...`
  - 配方类: `配方/合成/制作/加工...`
- 规则 6: 若 `documentMap` 为空，回退到 `brief.description`。

---

后续可以基于本文档直接定义“提取中间模型”（item relations + machine recipes），再落地到 JEI Web 的 `items/recipeTypes/recipes`。
