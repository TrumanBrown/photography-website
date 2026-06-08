module.exports = async function (context) {
  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: { ok: true, time: new Date().toISOString() },
  };
};
