# @weibaohui/dsh-settings-ui

[![DSH plugin](https://img.shields.io/badge/dsh-plugin-green)](https://github.com/topics/dsh-plugin)
[![npm version](https://img.shields.io/npm/v/@weibaohui/dsh-settings-ui)](https://www.npmjs.com/package/@weibaohui/dsh-settings-ui)

**dsh 设置界面自定义**：调整 dsh 原生设置窗口的大小、透明度与背景。设置项就在设置窗口里（左侧导航「设置界面」），改动即时生效。

## 核心功能

- **窗口大小**：默认（800×800）/ 大（1080×780）/ 特大（1280×960）/ 全屏 / 自定义宽高（≥480×360，小屏自动收缩）
- **背景不透明度**：30%–100%，半透明毛玻璃效果（跟随明暗主题）
- **背景**：主题默认 / 纯色（取色器）/ 图片（URL，cover 铺满）
- 改动即时生效，随 dsh profile 保存（换浏览器不丢）；「恢复默认」一键还原

## 安装

```bash
dsh plugin --profile web add @weibaohui/dsh-settings-ui -w
```

装完重启 `dsh web` 即生效。

## 使用

打开 Web UI → 设置 → 左侧导航「设置界面」→ 选尺寸、拖不透明度、选背景。关掉重开设置窗口即可看到效果；全屏模式适合小屏或需要同时看对话的场景。

## 说明

- 尺寸/透明度/背景只作用于原生设置窗口本身，不影响其他界面
- 适配的宿主面板类名来自 `dsh-client-ui-settings-general`（dsh 0.1.1-rc.2 实测）；dsh 大版本升级若面板类名变化，调整会静默失效（无害，恢复默认样式），届时更新本插件即可
