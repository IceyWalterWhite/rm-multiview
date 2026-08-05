# 沙盘模块的离线工具

这些脚本只在**重新标定**时用，线上代码一行都不依赖它们。
运行需要 `opencv-python` 和赛事录屏（路径写在两个 `*.spec.json` 的 `source` 字段里）。

## ⚠ 色彩矩阵：离线抽出来的像素与浏览器不是同一个色空间

**这些脚本抽的是 BT.601 像素，生产（Chrome）解出来的是 BT.709。**
2026-08-04 现网验收时踩到：自机绿的色相中位在浏览器是 80、离线是 76，
`SELF_MARKER_GREEN` 的上沿又恰好卡在离线那组的谷底，于是在生产上切掉了真实的
标记像素 —— 位置检出 81% 被压到 72.5%。详细证据链见 `src/rmui/layout.ts`
里 `SELF_MARKER_GREEN` 的注释。

成因有两个，方向一致：

- 现网 `.ts` 流**不带色彩元数据**（裸 `yuv420p`，无 VUI），解码器只能猜；
  ffmpeg 猜 BT.601，Chrome 猜 BT.709。同一文件强制两种矩阵解，色相差 2.5。
- 夹具用的 mp4 虽然明确标了 `bt709`，但 **`cv2.VideoCapture` 不理会这个标签**
  （实测 cv2 的结果与「强制当 601」重合，与「按标签」差 2.7）。

怎么办：

- ffmpeg 管线加 `-vf scale=in_color_matrix=bt709`。
- cv2 没有对应开关，要么换成 ffmpeg 管道解码，要么接受它是 601。
- **在换掉之前，离线量到的绝对检出率不能直接外推到浏览器。**
  跨管线只比「同一数据集上改一个参数带来的差分」，那是可信的；
  要定绝对阈值，就得拿浏览器抓的像素来定。

## 为什么用 Python 做这一半

TS 侧要的是「一帧 RGBA」，而把 mp4 解码成帧是脏活。分工是：
Python 只负责**解码与抽取 ROI**，算法本身一行都不在 Python 里 ——
避免同一套逻辑写两遍、然后悄悄跑偏。

## 三条流水线

### 1. 像素夹具（提交进仓库）

```bash
python tools/sandbox/dump_fixtures.py
```

按 `fixtures.spec.json` 抽帧，写到 `src/sandbox/__fixtures__/`。
只存 ROI（整帧 852×480 RGBA 是 1.6MB），测试侧再贴回一张全尺寸黑帧 ——
被测函数拿到的仍然是「一整帧」，公开 API 不为测试变形。
ROI 之外留作不透明黑：万一哪个算法悄悄依赖了 ROI 外的内容，测试会立刻红。

`fixtures.spec.json` 里的 `hp` 是人工从放大接触表读出的真值；
`expectMarker` 是人工在标注图上逐帧核对过的。**不要凭猜填。**

### 2. 字形样本集（生成 `src/sandbox/glyphs.ts`）

模板从真实画面提取，不是手绘的。做法是**监督配对**：
每帧血量真值已知，于是 `"198/200"` 切出的 7 个字形依次就是 `1,9,8,/,2,0,0`。

三个要点，都是踩过坑才定下来的：

- **每个阈值各取一份样本**。推理时会在整条阈值阶梯上试，训练分布就该与之对齐。
  32 帧标注因此变成 173 个 (帧,阈值) 组合、1194 个字形样本。
- **k-means 取聚类中心，不要最远点采样**。后者专挑离群点：`'0'` 有 401 个样本却只留下
  10 个最古怪的，典型的 `'0'` 反而离某个 `'6'` 更近 —— 末位 `0` 因此被读成 `6`。
- **保留多个样本，不要取平均**。样本少时平均有害：`'8'` 的两个不同渲染被平均成了
  一个谁也不像的东西，`198` 因此被读成 `196`。

生成流程目前是一段一次性的 vitest 探针（见 git 历史）。要重建模板时，
把 `segmentCandidates()` 的输出按真值配对、跑 k-means、按 `glyphs.ts` 的十六进制格式写回即可。

### 3. 留出集精度评估（不提交像素）

```bash
python tools/sandbox/dump_fixtures.py \
  --spec tools/sandbox/holdout.spec.json \
  --out testdata/sandbox-holdout
npx vitest run src/sandbox/holdout.test.ts
```

`holdout.spec.json` 的 27 帧**不在** `fixtures.spec.json` 里，一个字形样本都没参与训练，
所以这里的正确率才是可以对外报的数字。像素走 gitignored 的 `testdata/`：
标注提交、像素不提交，有录屏的人都能复现，仓库又不会变胖。

没生成时 `holdout.test.ts` 整组跳过，而不是假装通过。

## 标注图（人工核对朝向）

```bash
python tools/sandbox/annotate.py --probe <marker_probe.json> --out annotated.png
```

朝向没有现成真值，肉眼看箭头是唯一诚实的验收方式：
先渲染标注图确认方向无误，再把算出来的值冻结成回归基线。

## 全场扫描（调阈值用）

```bash
python tools/sandbox/dump_fixtures.py --sweep 10   # 三个回合内每 10s 抽一帧
```

回合时段 `(425,857) (1289,1721) (2033,2462)` 是由**音频静音边界**定出来的，
不是猜的 —— 见 `src/matchstate/signals.ts`。
