'use strict';

/**
 * 极简 JSON 文件仓储。
 *
 * 这是「入库」的当前实现：用户与会话写入 data/*.json，进程重启后仍然存在。
 * 迁移到 MySQL / Redis 时，只需保持以下两个方法签名不变：
 *   read()            -> Promise<data>
 *   mutate(fn)        -> Promise<result>，fn 收到 data 对象，可就地修改
 * mutate 内部串行化，保证同一进程内不会出现并发写覆盖。
 */
const fs = require('node:fs/promises');
const path = require('node:path');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createJsonStore(file, initialValue) {
  let queue = Promise.resolve();

  async function read() {
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return clone(initialValue);
      throw err;
    }
  }

  async function write(data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, file); // 原子替换，避免写一半被读到
  }

  function mutate(fn) {
    const job = queue.then(async () => {
      const data = await read();
      const result = await fn(data);
      await write(data);
      return result;
    });
    // 无论成功失败都让队列继续，但错误仍会抛给调用方
    queue = job.then(() => undefined, () => undefined);
    return job;
  }

  return { read, mutate, file };
}

module.exports = { createJsonStore };
