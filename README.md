# 教务台 ClassDesk · 教学文件管理（Teaching File Manager）

一个**给培训机构教务用的本地文件 + 学员管理工具**：把散在硬盘里的课件、考勤、结算表收进一个库，能全文搜、能筛、能改名移动、能一键出考勤表、还能批量转格式。

全部数据都在自己电脑上，不联网、不上传。

## 它能做什么

### 1. 文件库
- 导入（复制或移动进库）、自动跳过垃圾文件、重名自动加 `(2)`
- **全文搜索**：文件名 + 正文（Word / Excel / PPT / TXT / 代码里的字都能命中）
- 筛选：类型、标签、所在文件夹、大小、修改日期
- 改名 / 移动 / 删除（进回收站，可恢复）
- 标签、备注、收藏、保存当前筛选为「我的视图」
- 目录变了自动重建索引（`fs.watch` + 轮询 revision）

### 2. 在线改文件（不用装 Office）
- **docx**：按原格式渲染（样式、表格），直接改段落文字，保存时只替换文字、不动图片表格
- **xlsx**：按原列宽行高渲染，双击单元格改值，公式单元格只读
- **pptx**：「翻页看文字」，逐页列出文字，方便快速找内容
- 右键菜单：打开 / 在文件夹中显示 / 收藏 / 改名 / 移动 / 删除 / 转 PDF / 转图片

### 3. 格式转换
- 场景化入口（打印用 PDF、发微信用图片、要 Excel 能继续算…）+ 中文搜索
- 支持 **182 种输出格式**，产物直接进库，右下角任务条显示进度
- 引擎三级：WPS `kwpsconvert.exe` → Filee CLI → 自研 PDF/docx/xlsx 读写（装了哪个用哪个）

### 4. 考勤表（学生 / 教师 / 校区）
- **学生考勤**：按周上课，每次打勾；支持「班块」模型（一个表里多个班、不同星期、不同起止日期）
- **教师考勤**：一个月一张，按天打勾，自动统计假期/上班/实上/休息/调休/请假/加班/结余
- **用你自己的 Excel 模板**：自动识别日网格、周区间、课次三种版式，只保留目标表
- 名单可以拖图片或 Excel 进来，**OCR 自动识别**姓名/电话/班级

### 5. 教务工作台 + 学员管理
- 工作台：教学文件管理 / 学员管理 / 排课与收支（规划中）
- 学员：档案、报读课程、单价（元/课次）、应收 = 单价 × 课次、实收、欠费、课时进度、赠礼领取
- 批量增删改、导入 Excel 自动认表头、导出 xlsx/csv

## 技术形态

- **后端**：`server.js`，纯 Node 内置模块，**零第三方依赖**，只监听 `127.0.0.1`
- **前端**：原生 HTML/CSS/JS（`public/`），无框架、无构建步骤
- **外壳**：`launcher.cs` → C# WinForms + **WebView2**，编译成单文件 exe，带托盘、单实例、端口自适应
- **存储**：文件库是普通文件夹；元数据在 `<库>/.edu/`（索引、标签、学员 json、回收站）

## 目录结构

```
server.js              HTTP 服务 + 全部 API
lib/                   业务模块
  store.js             索引、标签、备注、收藏、回收站
  extract.js           正文抽取（docx/xlsx/pptx/pdf/txt/代码）
  zip.js               自写 zip 读写
  pdftext.js  docxwrite.js  sheetwrite.js   自研 PDF/docx/xlsx 读写
  attendance.js  attpl.js                   考勤表生成 + 模板识别
  convert.js  filee.js  wpscli.js           格式转换调度
  edustore.js  autotag.js  analyse.js       学员库 / 智能标签 / 重复与系列分析
public/
  files.html  app.js    文件库界面
  hub.html    hub.js    教务工作台
  students.html  students.js  学员管理
  picker.js             仿资源管理器选文件夹
launcher.cs             WebView2 外壳
tools/
  ocr.ps1              Windows.Media.Ocr 识别名单
  office2pdf.ps1       Office COM 转 PDF
  pdf2png.ps1          PDF 转图片
```

## 跑起来

### 最快：只用浏览器
```bash
# 需要 Node.js 18+（无任何 npm 依赖）
node server.js
# 浏览器打开 http://127.0.0.1:7788
```

### 打包成桌面程序
1. 把 Node 运行时放到 `runtime\node.exe`（从 Node.js 官网拷一个即可，约 88 MB）
2. 编译外壳（Windows SDK 自带 csc）：
```bat
csc /target:winexe /out:教学文件管理.exe ^
    /r:Microsoft.Web.WebView2.Core.dll /r:Microsoft.Web.WebView2.WinForms.dll ^
    /win32icon:icon.ico /resource:icon.ico,AppIcon.ico launcher.cs
```
3. 需要 **WebView2 运行时**（Win10/11 一般已自带）和三个 DLL：
   `Microsoft.Web.WebView2.Core.dll`、`Microsoft.Web.WebView2.WinForms.dll`、`WebView2Loader.dll`

### 可选增强
| 想要 | 放哪 |
|---|---|
| 182 种格式互转 | 解压 [Filee](https://github.com/) CLI 到 `tools/filee/filee-cli.exe` |
| Office 排版保真转换 | 装 WPS（自动找 `office6\kwpsconvert.exe`）或 Office |
| OCR 识别名单图片 | 系统自带 `Windows.Media.Ocr` 中文语言包 |

## 配置
首次运行会在程序目录生成 `config.json`：
```json
{ "port": 7788, "root": "D:\\MyLibrary", "source": "" }
```
- `root`：资料库根目录（文件都复制/移动到这里，元数据在 `root\.edu`）
- `source`：默认导入来源文件夹（可留空）

## 说明
- 只绑 `127.0.0.1`，不对外网开放
- 删除一律先进回收站，可以恢复
- 这是给个人/小机构自用的工具，没有账号体系，也别放到公网

## 许可
MIT
