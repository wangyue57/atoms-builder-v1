# ADR 0005：一期采用单腾讯云 CVM 自托管部署 Profile

状态：Accepted

## 背景

项目的第一目标是由一个人租用一台腾讯云服务器，部署全部平台服务，并提供一个类似 atoms.dev 的公网入口。现有模块必须能够在单机运行，同时保留未来拆分服务的可能。

## 决策

一期使用一台腾讯云 CVM、Docker Compose、单一域名和 Caddy/Nginx。Studio、Control API、Workflow Worker、Temporal、Postgres、Redis、Sandbox Manager、Preview Gateway 和部署服务都作为内部容器运行。

只有反向代理暴露公网端口。数据库、Redis、Temporal 和预览容器不暴露到公网。项目版本和 Artifact 通过 Adapter 保存；COS 作为推荐的备份和大文件存储，严格单机模式可以使用本机对象存储。

## 原因

- 降低第一阶段运维复杂度。
- 能在一台服务器上完成端到端验证。
- Docker Compose 与模块 Adapter 之间有清晰 seam。
- 后续可把 Sandbox、数据库、Artifact Store 和部署切换到独立服务。

## 后果

- 单机是单点故障。
- CPU、内存、磁盘和网络需要通过额度和并发限制保护。
- 自托管容器不等于强隔离微虚拟机。
- 一期只适合开发、内部或受信闭测；面对陌生公网用户前必须增加独立 Sandbox 节点、备份和高可用。
