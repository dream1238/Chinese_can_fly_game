# 《中国人能飞》游玩数据快照与账号迁移记录

创建日期：2026-08-17（登录系统上线日）

## 一、旧版本数据快照（迁移来源）

登录系统上线前，游玩数据直接存储于浏览器 localStorage 的裸键（无账号隔离），共 17 个持久化键：

| 键 | 内容 |
|---|---|
| ccf_redPackets | 红包累计总数 |
| ccf_highScore / ccf_highEndless | 关卡 / 无尽最高分 |
| ccf_artifact_own / ccf_artifact_used | 大变幡购买 / 使用状态 |
| ccf_skin_own / ccf_skin / ccf_skin_silver_own / ccf_skin_feather_own | 皮肤购买与装备状态 |
| ccf_eight_own / ccf_eight_used | 八方来财购买 / 使用状态 |
| ccf_basin_count / ccf_basin_active | 聚宝盆持有数 / 生效状态 |
| ccf_repair_count / ccf_repair_active | 紧急维修持有数 / 生效状态 |
| ccf_firesupport_own / ccf_firesupport_used | 火力支援购买 / 使用状态 |
| ccf_timefield_own / ccf_timefield_used | 错乱时空购买 / 使用状态 |
| ccf_seenGuide | 是否看过指引 |
| ccf_soundOn | 声音开关状态 |
| ccf_log_games / ccf_log_kills / ccf_log_seconds | 飞行日志（局数 / 击毁 / 时长） |
| ccf_daily_endless_day / _best / _prev | 无尽今日 / 昨日最高分 |
| ccf_gold_day / ccf_gold_first / ccf_gold_shown | 金飞机彩蛋状态 |
| ccf_cleared_l2 / ccf_cleared_l3 | 历史通关第 2 / 3 关 |
| ccf_boss_kills / ccf_perfect_clears | Boss 击杀数 / 三关无伤通关数 |

## 二、自动迁移机制（无需手动操作）

1. 新版本（登录系统）**首次加载**时：`migrateLegacyData()` 自动把上述全部裸键打包为 `ccf_migrated_data` 暂存。
2. `ensureDevAccount()` 自动创建开发者账号 **YH（密码 456789）**，并把暂存数据导入 YH 账号命名空间（`ccf_u_YH_*`），随后删除暂存。
3. 首次加载自动登录 YH → 进入首页即完美还原旧数据。

## 三、账号数据隔离规则

- 每个账号的数据存放于 `ccf_u_<用户名>_<键>` 命名空间，互不干扰。
- 新用户注册 → 命名空间为空 → 全新默认数据。
- 注销账户 → 删除该账号命名空间全部键 + 账号表条目（含密码），不可恢复。
- 数据保存在用户各自浏览器（GitHub Pages 纯静态托管，无服务器端账号，换设备需重新注册）。

## 四、开发者账号

| 账户名 | 密码 | 说明 |
|---|---|---|
| YH | 456789 | 开发者账号（预置，已导入旧版本全部数据） |
