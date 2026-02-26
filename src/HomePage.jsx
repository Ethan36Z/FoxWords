function HomePage({ onNavigate }) {
  return (
    <div className="page">
      <div className="container stack">
        <h2>欢迎回来，小狐狸 🦊</h2>
        <p className="text-muted">选择词书开始学习，或者打开生词本复习。</p >

        <div className="home-grid">
          <button className="home-card" onClick={() => onNavigate("/books")}>
            <h3>单词书选择</h3>
            <p className="text-muted">选择词书，开始今天的练习。</p >
            <span className="home-card-cta">进入 →</span>
          </button>

          <button className="home-card" onClick={() => onNavigate("/notebook")}>
            <h3>生词本</h3>
            <p className="text-muted">查看你标记的生词，准备故事复习。</p >
            <span className="home-card-cta">打开 →</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default HomePage;