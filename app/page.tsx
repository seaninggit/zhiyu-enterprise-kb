"use client";

import { useMemo, useState } from "react";

type Category = "全部" | "产品研发" | "组织人事" | "销售市场" | "财务法务";

type KnowledgeItem = {
  id: number;
  title: string;
  excerpt: string;
  category: Exclude<Category, "全部">;
  owner: string;
  updated: string;
  views: string;
  tag: string;
  readTime: string;
  status: "已发布" | "待复核";
};

const categories: { name: Category; count: number; icon: string }[] = [
  { name: "全部", count: 328, icon: "⌂" },
  { name: "产品研发", count: 86, icon: "◇" },
  { name: "组织人事", count: 64, icon: "◎" },
  { name: "销售市场", count: 103, icon: "↗" },
  { name: "财务法务", count: 75, icon: "▤" },
];

const knowledge: KnowledgeItem[] = [
  {
    id: 1,
    title: "新员工入职指南",
    excerpt: "从账号开通、办公环境到团队融入，一份完整的新员工上手手册。",
    category: "组织人事",
    owner: "People 团队",
    updated: "2 天前",
    views: "2.4k",
    tag: "新手必读",
    readTime: "8 分钟",
    status: "已发布",
  },
  {
    id: 2,
    title: "产品需求评审规范",
    excerpt: "明确 PRD 准入标准、评审角色、决策记录与变更管理流程。",
    category: "产品研发",
    owner: "产品委员会",
    updated: "5 天前",
    views: "1.8k",
    tag: "核心流程",
    readTime: "12 分钟",
    status: "已发布",
  },
  {
    id: 3,
    title: "客户数据安全与分级标准",
    excerpt: "客户信息采集、存储、使用、共享与销毁的全生命周期要求。",
    category: "财务法务",
    owner: "安全合规部",
    updated: "1 周前",
    views: "1.2k",
    tag: "合规",
    readTime: "15 分钟",
    status: "待复核",
  },
  {
    id: 4,
    title: "品牌视觉使用手册",
    excerpt: "统一品牌标识、色彩、字体及对外传播素材的使用方式。",
    category: "销售市场",
    owner: "品牌中心",
    updated: "8 天前",
    views: "986",
    tag: "品牌资产",
    readTime: "10 分钟",
    status: "已发布",
  },
];

const quickLinks = [
  { icon: "▱", title: "请假与考勤", meta: "制度 · 6 篇" },
  { icon: "⌘", title: "IT 服务台", meta: "指南 · 12 篇" },
  { icon: "◫", title: "费用报销", meta: "流程 · 8 篇" },
  { icon: "◉", title: "信息安全", meta: "规范 · 15 篇" },
];

export default function Home() {
  const [category, setCategory] = useState<Category>("全部");
  const [query, setQuery] = useState("");
  const [showAi, setShowAi] = useState(false);
  const [notice, setNotice] = useState("");

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return knowledge.filter((item) => {
      const categoryMatch = category === "全部" || item.category === category;
      const searchMatch =
        !keyword ||
        `${item.title}${item.excerpt}${item.category}${item.owner}`
          .toLowerCase()
          .includes(keyword);
      return categoryMatch && searchMatch;
    });
  }, [category, query]);

  function triggerNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="知域知识库首页">
          <span className="brand-mark">Z</span>
          <span>知域</span>
        </a>
        <nav className="main-nav" aria-label="主导航">
          <a className="active" href="#">知识广场</a>
          <a href="#favorites">我的收藏</a>
          <a href="#workspace">团队空间</a>
        </nav>
        <div className="header-actions">
          <button className="icon-button" aria-label="查看通知" onClick={() => triggerNotice("你有 3 条待处理通知")}>
            ♢<span className="notification-dot" />
          </button>
          <button className="avatar" aria-label="打开个人菜单">L</button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-glow hero-glow-one" />
          <div className="hero-glow hero-glow-two" />
          <div className="hero-content">
            <span className="eyebrow"><i /> 让知识流动起来</span>
            <h1>每一次查找，都离答案更近一步</h1>
            <p>沉淀团队经验，连接组织智慧。这里有你工作所需的一切知识。</p>
            <div className="search-wrap">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="搜索知识库"
                placeholder="搜索知识、文档或问题..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") triggerNotice(`已找到 ${filtered.length} 条相关内容`);
                }}
              />
              <kbd>⌘ K</kbd>
              <button onClick={() => triggerNotice(`已找到 ${filtered.length} 条相关内容`)}>搜索</button>
            </div>
            <div className="hot-search">
              <span>热门搜索</span>
              {["入职流程", "报销制度", "产品规范", "客户案例"].map((term) => (
                <button key={term} onClick={() => setQuery(term)}>{term}</button>
              ))}
            </div>
          </div>
        </section>

        <section className="content-section" aria-labelledby="category-title">
          <div className="section-heading">
            <div>
              <span className="section-kicker">EXPLORE</span>
              <h2 id="category-title">探索知识分类</h2>
            </div>
            <button className="text-button" onClick={() => setCategory("全部")}>查看全部 <span>→</span></button>
          </div>
          <div className="category-grid">
            {categories.slice(1).map((item, index) => (
              <button
                className={`category-card tone-${index + 1} ${category === item.name ? "selected" : ""}`}
                key={item.name}
                onClick={() => setCategory(item.name)}
              >
                <span className="category-icon">{item.icon}</span>
                <span className="category-copy">
                  <strong>{item.name}</strong>
                  <small>{item.count} 篇知识</small>
                </span>
                <span className="card-arrow">↗</span>
              </button>
            ))}
          </div>
        </section>

        <section className="content-section knowledge-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">FEATURED</span>
              <h2>精选知识</h2>
            </div>
            <div className="tabs" role="tablist" aria-label="知识筛选">
              {categories.map((item) => (
                <button
                  role="tab"
                  aria-selected={category === item.name}
                  className={category === item.name ? "active" : ""}
                  key={item.name}
                  onClick={() => setCategory(item.name)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          {filtered.length ? (
            <div className="knowledge-grid">
              {filtered.map((item) => (
                <article className="knowledge-card" key={item.id}>
                  <div className="card-topline">
                    <span className="label">{item.tag}</span>
                    <span className={`status ${item.status === "待复核" ? "review" : ""}`}>{item.status}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.excerpt}</p>
                  <div className="document-meta">
                    <span>{item.category}</span><i />
                    <span>{item.readTime}</span><i />
                    <span>浏览 {item.views}</span>
                  </div>
                  <div className="owner-row">
                    <span className="mini-avatar">{item.owner.slice(0, 1)}</span>
                    <span><b>{item.owner}</b><small>更新于 {item.updated}</small></span>
                    <button aria-label={`打开${item.title}`} onClick={() => triggerNotice(`正在打开「${item.title}」`)}>→</button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span>⌕</span>
              <h3>没有找到相关知识</h3>
              <p>换个关键词，或清除筛选后再试试。</p>
              <button onClick={() => { setQuery(""); setCategory("全部"); }}>清除筛选</button>
            </div>
          )}
        </section>

        <section className="quick-section">
          <div className="quick-inner">
            <div className="section-heading">
              <div>
                <span className="section-kicker">QUICK ACCESS</span>
                <h2>常用入口</h2>
              </div>
              <span className="subtle-copy">高频制度与服务，一步直达</span>
            </div>
            <div className="quick-grid">
              {quickLinks.map((item) => (
                <button key={item.title} onClick={() => triggerNotice(`已进入${item.title}`)}>
                  <span>{item.icon}</span>
                  <span><b>{item.title}</b><small>{item.meta}</small></span>
                  <i>→</i>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="workflow-section" id="workspace">
          <div className="workflow-copy">
            <span className="section-kicker">KNOWLEDGE LIFECYCLE</span>
            <h2>从经验，到组织资产</h2>
            <p>清晰的责任人与治理机制，让每一份知识都可信、可追溯、持续更新。</p>
          </div>
          <ol className="workflow">
            <li><span>01</span><b>创建草稿</b><small>模板化沉淀经验</small></li>
            <li><span>02</span><b>协作评审</b><small>专家校验与留痕</small></li>
            <li><span>03</span><b>审批发布</b><small>权限与版本生效</small></li>
            <li><span>04</span><b>复核迭代</b><small>反馈驱动持续更新</small></li>
          </ol>
        </section>
      </main>

      <button className="ai-fab" onClick={() => setShowAi(true)} aria-label="打开智能问答">
        <span>✦</span>
        <span><b>问问小知</b><small>AI 智能问答</small></span>
      </button>

      {showAi && (
        <div className="modal-backdrop" onMouseDown={() => setShowAi(false)}>
          <section className="ai-panel" role="dialog" aria-modal="true" aria-labelledby="ai-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setShowAi(false)} aria-label="关闭">×</button>
            <span className="ai-orb">✦</span>
            <h2 id="ai-title">你好，我是小知</h2>
            <p>我会基于已授权的企业知识回答，并标注引用来源。</p>
            <div className="suggestions">
              <button onClick={() => setQuery("入职流程")}>新员工第一周要做什么？</button>
              <button onClick={() => setQuery("报销制度")}>差旅费用怎么报销？</button>
            </div>
            <div className="ai-input">
              <input aria-label="向小知提问" placeholder="输入你的问题..." />
              <button onClick={() => triggerNotice("演示模式：回答将引用企业内部知识")}>发送</button>
            </div>
          </section>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}
