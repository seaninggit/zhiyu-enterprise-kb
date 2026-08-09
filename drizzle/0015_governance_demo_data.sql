-- 知域 · 治理 Demo 数据
-- 模拟真实企业知识治理场景：过期、重复、解析失败、草稿、待审核等

-- 确保基础部门存在
INSERT OR IGNORE INTO departments(id,code,name,is_active) VALUES(1,'GENERAL','综合管理部',1);
INSERT OR IGNORE INTO departments(id,code,name,is_active) VALUES(2,'PRODUCT','产品研发部',1);
INSERT OR IGNORE INTO departments(id,code,name,is_active) VALUES(3,'HR','组织人事部',1);
INSERT OR IGNORE INTO departments(id,code,name,is_active) VALUES(4,'SALES','销售市场部',1);
INSERT OR IGNORE INTO departments(id,code,name,is_active) VALUES(5,'FINANCE','财务法务部',1);

-- 确保角色存在
INSERT OR IGNORE INTO roles(id,code,name,description) VALUES(1,'SUPER_ADMIN','超级管理员','全局知识治理');
INSERT OR IGNORE INTO roles(id,code,name,description) VALUES(2,'DEPT_ADMIN','部门管理员','本部门知识治理');
INSERT OR IGNORE INTO roles(id,code,name,description) VALUES(3,'EMPLOYEE','普通员工','知识生产与使用');

-- ============================================
-- 场景 1：已过期文档（review_due_at 已过）
-- Agent 应自动发现并建议作废
-- ============================================
INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2001,2,9002,9002,9002,'产品需求文档模板 V1.0','已过期的旧版 PRD 模板，已被 V2.0 替代','本文档为产品需求文档（PRD）的早期模板版本，包含需求背景、功能描述、验收标准等章节。该版本已于 2025年3月废止，请使用 V2.0 版本。','产品研发','ARCHIVED_ACTIVE','DEPT','INTERNAL','王磊','王磊',1,'2025-03-15','COMPLETED','INDEXED','CLEAN','UNVERIFIED');

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2002,3,9003,9003,9003,'2019年绩效考核办法','已过期，2022年起已启用新制度','本办法适用于2019-2021年度绩效考核，包含KPI设定、评估周期、结果应用等内容。2022年起已启用新版《员工绩效管理制度 V3.0》，本办法不再适用。','组织人事','ARCHIVED_ACTIVE','DEPT','INTERNAL','苏晴','苏晴',2,'2022-12-31','COMPLETED','INDEXED','CLEAN','UNVERIFIED');

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2003,5,9005,9005,9005,'2023年度差旅标准','已过期，2024年起已调整标准','2023年度差旅费用标准：一线城市住宿上限500元/晚，二线城市350元/晚，交通费用实报实销。2024年起已按新标准执行，住宿上限分别调整为550元和400元。','财务法务','ARCHIVED_ACTIVE','CROSS_DEPT','INTERNAL','张明','张明',1,'2023-12-31','COMPLETED','INDEXED','CLEAN','UNVERIFIED');

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2004,2,9002,9002,9002,'旧版代码评审规范','2020年制定，已被CI/CD自动化流程替代','手动代码评审流程：提交PR→指定评审人→线下会议→记录评审意见→修复→复审。2024年起已全面切换到 GitLab CI + 自动化检查 + 异步评审模式。本文档已不再使用。','产品研发','ARCHIVED_ACTIVE','DEPT','INTERNAL','王磊','王磊',1,'2024-06-30','COMPLETED','INDEXED','CLEAN','UNVERIFIED');

-- ============================================
-- 场景 2：疑似重复内容（标题或内容高度相似）
-- Agent 应检测并标记为疑似重复
-- ============================================
INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2005,3,9003,9003,9003,'新员工入职培训流程','新员工入职第一周的培训安排','新员工入职后需完成：Day1 公司文化与制度介绍、IT设备领取、办公环境熟悉；Day2-3 部门业务培训；Day4-5 岗位技能实操。由HR和直属主管共同负责。','组织人事','ARCHIVED_ACTIVE','DEPT','INTERNAL','苏晴','苏晴',1,'2026-12-31','COMPLETED','INDEXED','CLEAN','VERIFIED');

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2006,3,9003,9003,9003,'新员工入职指南与培训安排','与《新员工入职培训流程》内容高度重复','新员工入职第一周安排：Day1 了解公司文化与制度、领取IT设备、熟悉办公环境；Day2-3 参加部门业务培训；Day4-5 岗位技能实操练习。由HR和直属上级共同负责新员工的入职引导。','组织人事','ARCHIVED_ACTIVE','DEPT','INTERNAL','苏晴','苏晴',1,'2026-12-31','COMPLETED','INDEXED','CLEAN','VERIFIED');

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2007,5,9005,9005,9005,'费用报销制度','报销流程和标准总则','员工费用报销需遵循：真实性原则（费用必须真实发生）、合规性原则（符合公司制度和税法要求）、及时性原则（发生后30日内提交）。报销单需经直属主管和财务双审。','财务法务','ARCHIVED_ACTIVE','CROSS_DEPT','INTERNAL','张明','张明',1,'2026-12-31','COMPLETED','INDEXED','CLEAN','VERIFIED');

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2008,5,9005,9005,9005,'公司费用报销管理办法','与《费用报销制度》内容高度重叠','公司费用报销管理遵循三大原则：真实性（确保费用实际发生）、合规性（遵守公司制度与税法）、及时性（发生后30天内提交报销申请）。所有报销须经直属主管审批和财务部门复核。','财务法务','ARCHIVED_ACTIVE','CROSS_DEPT','INTERNAL','张明','张明',2,'2026-12-31','COMPLETED','INDEXED','CLEAN','VERIFIED');

-- ============================================
-- 场景 3：解析失败文档
-- Agent 应发现并建议重新上传或手动录入
-- ============================================
INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status,source_name,mime_type,size)
VALUES(2009,2,9002,9002,9002,'技术架构设计文档','上传的 PDF 解析失败，需重新处理','','产品研发','DRAFT','DEPT','INTERNAL','王磊','王磊',1,'2026-12-31','FAILED','PENDING','PENDING','UNVERIFIED','architecture-v3.pdf','application/pdf',2450000);

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status,source_name,mime_type,size)
VALUES(2010,4,9004,9004,9004,'2025年市场分析报告','上传的 XLSX 解析失败','','销售市场','DRAFT','DEPT','INTERNAL','赵刚','赵刚',1,'2026-06-30','FAILED','PENDING','PENDING','UNVERIFIED','market-analysis-2025.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',3800000);

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status,source_name,mime_type,size)
VALUES(2011,5,9005,9005,9005,'2024年审计底稿','扫描版 PDF OCR 失败，需手动录入关键数据','','财务法务','DRAFT','DEPT','SENSITIVE','张明','张明',1,'2026-06-30','OCR_FAILED','PENDING','PENDING','UNVERIFIED','audit-2024-scanned.pdf','application/pdf',5200000);

-- ============================================
-- 场景 4：待审核文档（堆积在 PENDING_DEPT_REVIEW）
-- Agent 应提醒管理员处理
-- ============================================
INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2012,2,9002,9002,9002,'API 接口设计规范 V3.0','RESTful API 统一设计标准','接口设计需遵循 RESTful 风格，使用 JSON 格式，统一错误码体系（参考文档附录A），所有接口必须包含认证 token、请求日志、限流策略。','产品研发','PENDING_DEPT_REVIEW','DEPT','INTERNAL','王磊','王磊',3,'2027-06-30','COMPLETED','INDEXED','CLEAN','UNVERIFIED');

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2013,3,9003,9003,9003,'2026年度培训计划','全年培训课程安排与预算','2026年计划开展：新员工入职培训（12期）、管理力提升（4期）、专业技能认证（6期）、外部讲师工作坊（2期）。总预算 180 万元，已报批。','组织人事','PENDING_DEPT_REVIEW','DEPT','INTERNAL','苏晴','苏晴',1,'2027-01-31','COMPLETED','INDEXED','CLEAN','UNVERIFIED');

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2014,4,9004,9004,9004,'Q3销售激励方案','第三季度销售竞赛与提成调整','Q3冲刺目标：新增客户300家，续费率85%，重点产品销售额增长20%。超额完成团队奖励3-5万元，个人TOP奖励1万元。提成阶梯详见正文。','销售市场','PENDING_DEPT_REVIEW','DEPT','SENSITIVE','赵刚','赵刚',1,'2026-09-30','COMPLETED','INDEXED','CLEAN','UNVERIFIED');

-- ============================================
-- 场景 5：即将到复核日期的文档（30天内）
-- Agent 应提醒管理员安排复核
-- ============================================
INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2015,2,9002,9002,9002,'数据库设计规范','MySQL 表设计、索引、命名规范','表名使用小写下划线命名（snake_case），主键统一使用自增 id，所有表必须包含 create_time 和 update_time 字段。索引命名：pk_表名、uk_字段名、idx_字段名。','产品研发','ARCHIVED_ACTIVE','DEPT','INTERNAL','王磊','王磊',2,date('now','+15 day'),'COMPLETED','INDEXED','CLEAN','VERIFIED');

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2016,5,9005,9005,9005,'合同审批权限表','各级管理人员的合同签署权限','合同金额≤10万：部门经理审批；10-50万：分管副总审批；50-200万：总经理审批；>200万：董事会审批。所有合同须经法务审核。','财务法务','ARCHIVED_ACTIVE','DEPT','SENSITIVE','张明','张明',1,date('now','+10 day'),'COMPLETED','INDEXED','CLEAN','VERIFIED');

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2017,1,9001,9001,9001,'信息安全管理制度','公司信息安全总体方针','信息资产分级：公开、内部、敏感、机密四级。员工须签署保密协议，离职时交还所有公司资料。禁止在个人设备存储敏感信息，禁止通过私人邮箱发送机密文件。','组织人事','ARCHIVED_ACTIVE','CROSS_DEPT','SENSITIVE','刘洋','刘洋',3,date('now','+8 day'),'COMPLETED','INDEXED','CLEAN','VERIFIED');

-- ============================================
-- 场景 6：内容为空的草稿（占位文档）
-- Agent 应发现并建议补充或删除
-- ============================================
INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2018,2,9002,9002,9002,'微服务拆分方案（待补充）','计划中，尚未撰写正文','','产品研发','DRAFT','DEPT','INTERNAL','王磊','王磊',1,'2027-01-01','NEEDS_CONTENT','PENDING','PENDING','UNVERIFIED');

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2019,4,9004,9004,9004,'海外市场拓展计划（草稿）','初步想法，尚未完善','','销售市场','DRAFT','DEPT','INTERNAL','赵刚','赵刚',1,'2027-03-01','NEEDS_CONTENT','PENDING','PENDING','UNVERIFIED');

-- ============================================
-- 场景 7：正常已发布文档（对照组）
-- ============================================
INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2020,2,9002,9002,9002,'产品需求文档模板 V2.0','新版 PRD 模板，替代已废止的 V1.0','产品需求文档（PRD）需包含：1.需求背景与目标 2.用户场景与用例 3.功能需求详述 4.非功能需求（性能、安全）5.验收标准 6.影响范围评估。使用此模板确保需求完整性。','产品研发','ARCHIVED_ACTIVE','DEPT','INTERNAL','王磊','王磊',2,'2027-06-30','COMPLETED','INDEXED','CLEAN','VERIFIED');

INSERT OR IGNORE INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,review_due_at,parse_status,ai_index_status,scan_status,verification_status)
VALUES(2021,3,9003,9003,9003,'员工绩效管理制度 V3.0','现行绩效管理规范','绩效管理周期：季度考核+年度综评。考核维度：工作业绩（60%）、能力成长（20%）、价值观契合（20%）。流程：自评→直属上级评价→隔级审批→HR复核→面谈反馈。','组织人事','ARCHIVED_ACTIVE','CROSS_DEPT','INTERNAL','苏晴','苏晴',3,'2027-06-30','COMPLETED','INDEXED','CLEAN','VERIFIED');

-- ============================================
-- 场景 8：已有治理任务（Agent 历史产出）
-- ============================================
INSERT OR IGNORE INTO knowledge_governance_tasks(id,type,status,dept_id,source_document_id,reporter_user_id,assignee_user_id,reason,detail,create_time)
VALUES(2001,'EXPIRED','OPEN',2,2001,9001,9002,'产品需求文档模板 V1.0 已过期','文档复核日期为 2025-03-15，已超过18个月未更新。建议作废或更新至当前版本。','2026-07-15');

INSERT OR IGNORE INTO knowledge_governance_tasks(id,type,status,dept_id,source_document_id,reporter_user_id,assignee_user_id,reason,detail,create_time)
VALUES(2002,'DUPLICATE','OPEN',3,2005,9001,9003,'新员工入职培训流程存在疑似重复文档','《新员工入职培训流程》(#2005) 与《新员工入职指南与培训安排》(#2006) 内容高度相似（相似度92%）。建议合并或明确差异。','2026-07-20');

INSERT OR IGNORE INTO knowledge_governance_tasks(id,type,status,dept_id,reporter_user_id,assignee_user_id,target_document_id,reason,detail,resolution,status,resolved_by,resolved_at,create_time)
VALUES(2003,'QUALITY','RESOLVED',5,9003,9005,2021,'员工费用报销标准需更新','2024年差旅住宿标准已上调，需更新《员工费用报销管理制度》','已按2026年新标准更新住宿费上限并调整审批流程','RESOLVED',9005,'2026-07-18','2026-07-10');

-- ============================================
-- 场景 9：搜索零结果记录（知识缺口）
-- ============================================
INSERT OR IGNORE INTO search_logs(id,user_id,dept_id,query,result_count,mode,create_time) VALUES(2001,9003,3,'远程办公',0,'HYBRID','2026-07-25');
INSERT OR IGNORE INTO search_logs(id,user_id,dept_id,query,result_count,mode,create_time) VALUES(2002,9004,4,'竞品分析',0,'HYBRID','2026-07-28');
INSERT OR IGNORE INTO search_logs(id,user_id,dept_id,query,result_count,mode,create_time) VALUES(2003,9002,2,'oncall',0,'HYBRID','2026-08-01');

-- 更新文档的 published 快照字段（用于检索）
UPDATE documents SET published_version=version,published_title=title,published_summary=summary,published_content=content WHERE status='ARCHIVED_ACTIVE' AND published_version IS NULL;

-- 生成文档切片（用于语义检索）
INSERT OR IGNORE INTO document_chunks(document_id,dept_id,document_version,chunk_index,content,is_active)
SELECT id,dept_id,version,0,substr(coalesce(content,summary,''),1,800),1 FROM documents WHERE status='ARCHIVED_ACTIVE' AND (content!='' OR summary!='') AND NOT EXISTS(SELECT 1 FROM document_chunks WHERE document_id=documents.id);
