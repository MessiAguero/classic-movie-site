import { useState, type FormEvent } from 'react';
import { addMessage, removeMessage, useMessages } from '../lib/messages';

export default function ContactPage() {
  const messages = useMessages();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setOk('');
    if (!name.trim() || !content.trim()) {
      setError('请填写称呼和留言内容');
      return;
    }
    if (content.trim().length < 5) {
      setError('留言内容至少 5 个字');
      return;
    }
    addMessage({
      name: name.trim(),
      contact: contact.trim(),
      content: content.trim(),
    });
    setName('');
    setContact('');
    setContent('');
    setOk('留言已提交，感谢你的支持！');
  };

  return (
    <div className="contact">
      <div className="page-title">
        <h1>联系我们</h1>
        <p>商务合作 · 联系方式 · 留言板</p>
      </div>
      <div style={{ height: 50 }} />

      <div className="contact-grid">
        {/* 商务合作 */}
        <div className="contact-card">
          <h3>商务合作</h3>
          <p>
            我们专注于经典电影内容运营，欢迎品牌联名、内容授权、媒体合作、
            活动策划等各类合作。合作方将获得每日推荐页品牌露出、专属专题栏目
            与社群推广等权益。
          </p>
          <div className="c-item">
            <span className="c-k">合作邮箱</span>
            <a href="mailto:business@classicmovie.example">business@classicmovie.example</a>
          </div>
          <div className="c-item">
            <span className="c-k">响应时间</span>
            <span>工作日 24 小时内回复</span>
          </div>
        </div>

        {/* 联系方式 */}
        <div className="contact-card">
          <h3>联系方式</h3>
          <div className="c-item">
            <span className="c-k">合作邮箱</span>
            <a href="mailto:business@classicmovie.example">business@classicmovie.example</a>
          </div>
          <div className="c-item">
            <span className="c-k">客服邮箱</span>
            <a href="mailto:support@classicmovie.example">support@classicmovie.example</a>
          </div>
          <div className="c-item">
            <span className="c-k">微信公众号</span>
            <span>经典电影推荐</span>
          </div>
          <div className="c-item">
            <span className="c-k">商务微信</span>
            <span>classicmovie-biz</span>
          </div>
          <div className="c-item">
            <span className="c-k">办公地址</span>
            <span>上海市 · 静安区 · 经典电影工作室（示例）</span>
          </div>
        </div>
      </div>

      {/* 留言板 */}
      <div className="msg-board">
        <h3>留言板</h3>
        <form className="msg-form" onSubmit={submit}>
          <label>
            称呼
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="你的昵称"
              maxLength={30}
            />
          </label>
          <label>
            联系方式（选填）
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="邮箱 / 微信 / 电话"
              maxLength={80}
            />
          </label>
          <label className="full">
            留言内容
            <textarea
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="想推荐的电影、想说的话、合作意向……"
              maxLength={500}
            />
          </label>
          {error && <div className="auth-error full">{error}</div>}
          {ok && <div className="auth-notice full">{ok}</div>}
          <button type="submit" className="auth-submit">
            提 交 留 言
          </button>
        </form>

        <div className="msg-list">
          {messages.length === 0 ? (
            <div className="msg-empty">还没有留言，来说两句吧</div>
          ) : (
            [...messages]
              .reverse()
              .map((m) => (
                <div className="msg-item" key={m.id}>
                  <div className="m-head">
                    <span className="m-name">{m.name}</span>
                    <span className="m-time">{new Date(m.createdAt).toLocaleString('zh-CN')}</span>
                    <button
                      className="m-del"
                      onClick={() => {
                        if (window.confirm('确认删除这条留言？')) removeMessage(m.id);
                      }}
                    >
                      删除
                    </button>
                  </div>
                  <p>{m.content}</p>
                  {m.contact && (
                    <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 6 }}>
                      联系方式：{m.contact}
                    </div>
                  )}
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}
