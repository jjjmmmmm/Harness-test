# 教程 04 · Docker Desktop 安装指南 · Windows（D1 晚 Block 6 配套）

> 分工：**AI 跑命令、你点弹窗**——UAC 授权框、重启确认这类系统级交互只能你来。
> 全程预算 30–60 分钟（大部分是下载时间）。装完的验证标准只有一个：`docker run hello-world` 出现 "Hello from Docker!"。

---

## 1. 为什么这个项目需要 Docker

JD 必须项原文："会起的 Docker 或等价的隔离环境"。原因有两层：

1. **实验纪律**：agent 会真的改文件、真的跑命令。在容器里跑，每次实验都是干净世界，跑完即焚——上一次实验绝不污染下一次（控制变量）。
2. **DSH 的沙箱**：DSH 的沙箱执行（`ctx.sandbox` / `bash-sandbox`）依赖容器技术，沙箱装不好，涉及沙箱的配置轴就测不了。

## 2. 安装流程（AI 指挥版）

以下命令你在**管理员 Git Bash**里执行，或让 AI 替你跑：

### 第 1 步：检查 WSL2（Docker Desktop 在 Windows 上依赖它）

```sh
wsl --status
```

- 如果显示"默认版本: 2"或类似 → 直接跳到第 2 步；
- 如果命令不存在/报错 → 先启用：
  ```sh
  wsl --install --no-distribution
  ```
  （**你会看到一个 UAC 弹窗，点"是"**；可能要求重启。）

### 第 2 步：安装 Docker Desktop

```sh
winget install Docker.DockerDesktop
```

没有 winget 就去 https://www.docker.com/products/docker-desktop/ 下载安装包双击安装（安装器里**勾选 "Use WSL 2 based engine"**）。

### 第 3 步：启动并验证

1. 开始菜单启动 **Docker Desktop**（首次要接受服务条款；**你可能看到 UAC 弹窗，点"是"**）；
2. 等右下角鲸鱼图标变绿/状态显示 "Engine running"；
3. 验证：
   ```sh
   docker run hello-world
   ```
   看到 `Hello from Docker!` = 全链路通。

### 第 4 步（可选但推荐）：配置镜像加速

国内拉镜像慢/失败时，Docker Desktop → Settings → Docker Engine，在 JSON 里加：

```json
"registry-mirrors": ["https://docker.m.daocloud.io"]
```

点 Apply & Restart。（镜像源时效性强，失效就搜"docker 镜像加速 可用"。）

## 3. 常见坑速查

| 症状 | 原因 | 处理 |
| :--- | :--- | :--- |
| `wsl --install` 后仍报错 | BIOS 没开虚拟化 | 重启进 BIOS 开 Intel VT-x / AMD-V（这一步只能你来，搜索"你的机型 + 开启虚拟化"） |
| Docker Desktop 卡在 starting | WSL 未就绪 | `wsl --update` 后重启 Docker Desktop |
| 拉镜像超时 | 网络问题 | 见第 4 步镜像加速 |
| 磁盘爆满 | 镜像/容器堆积 | `docker system prune -a`（确认没用的才清） |

## 4. 装完后的三个必做体验（10 分钟，建立"隔离"直觉）

```sh
# 体验 1：容器 = 用完即焚的干净世界
docker run --rm -it python:3.11-slim python -c "print('我在容器里')"
# --rm = 退出即删掉这个容器，什么都不留

# 体验 2：容器里的文件系统和你电脑是隔开的
docker run --rm python:3.11-slim ls /
# 看到的目录结构和你 Windows 的 C:/D: 完全无关

# 体验 3：挂载 = 给容器开一扇门（实验时让 agent 只能碰工作目录）
docker run --rm -v "D:\ZCode项目\腾讯项目\sandbox-test:/workspace" python:3.11-slim ls /workspace
```

**体会**：第 3 个 `-v` 挂载就是"agent 只能碰指定目录"的机制基础——权限边界不是靠口头约定，是靠这种机制强制执行的。

## 5. 验收清单

- [ ] `docker run hello-world` 输出 "Hello from Docker!"
- [ ] 能说出容器和虚拟机/venv 的区别（一句话版：venv 只隔离 Python 包，容器隔离整个文件系统+进程+网络）
- [ ] 完成 3 个体验，能说出 `--rm` 和 `-v` 各是干嘛的
- [ ] （如果失败超过 1 小时）记录卡在哪一步，先用 venv 顶替，报告里如实写
