// 계정·점수 저장소
// MONGODB_URI 환경 변수가 있으면 MongoDB(영구 저장), 없으면 data.json 파일(서버 재시작 시 사라질 수 있음)
const fs = require('fs');
const path = require('path');

function fileStore(file) {
  let users = {};
  try { users = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  let t = null;
  const save = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      try { fs.writeFileSync(file, JSON.stringify(users)); } catch (e) { console.error('저장 실패:', e.message); }
    }, 500);
  };
  const list = cls => Object.values(users).filter(u => !cls || u.cls === cls);
  return {
    kind: 'file(' + file + ')',
    async get(id) { return users[id] || null; },
    async create(u) { if (users[u.id]) return false; users[u.id] = u; save(); return true; },
    async addScore(id, score, solo) {
      const u = users[id]; if (!u) return null;
      u.total += score; u.games++; if (score > u.best) u.best = score;
      u[solo ? 'lastSolo' : 'lastVs'] = Date.now(); save(); return u;
    },
    async top(cls, n) { return list(cls).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id)).slice(0, n); },
    async rank(u, cls) { return list(cls).filter(x => x.total > u.total).length + 1; },
    async count(cls) { return list(cls).length; }
  };
}

async function mongoStore(uri) {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB || 'sciencequest').collection('users');
  await col.createIndex({ total: -1 });
  await col.createIndex({ cls: 1, total: -1 });
  const out = d => d && Object.assign({}, d, { id: d._id });
  const f = cls => cls ? { cls } : {};
  return {
    kind: 'mongodb',
    async get(id) { return out(await col.findOne({ _id: id })); },
    async create(u) {
      const { id, ...rest } = u;
      try { await col.insertOne({ _id: id, ...rest }); return true; }
      catch (e) { if (e.code === 11000) return false; throw e; }
    },
    async addScore(id, score, solo) {
      const r = await col.findOneAndUpdate(
        { _id: id },
        { $inc: { total: score, games: 1 }, $max: { best: score }, $set: { [solo ? 'lastSolo' : 'lastVs']: Date.now() } },
        { returnDocument: 'after' }
      );
      const doc = r && r.ok !== undefined && 'value' in r ? r.value : r; // 드라이버 버전 차이 대응
      return out(doc);
    },
    async top(cls, n) { return (await col.find(f(cls)).sort({ total: -1, _id: 1 }).limit(n).toArray()).map(out); },
    async rank(u, cls) { return (await col.countDocuments({ ...f(cls), total: { $gt: u.total } })) + 1; },
    async count(cls) { return col.countDocuments(f(cls)); }
  };
}

module.exports = async () => process.env.MONGODB_URI
  ? mongoStore(process.env.MONGODB_URI)
  : fileStore(process.env.DATA_FILE || path.join(__dirname, 'data.json'));
