'use strict';

/**
 * 前端与后端唯一的通信边界：所有请求都走这里，页面不直接拼 fetch。
 * 令牌保存在 Web Storage，请求时自动带 Authorization: Bearer <token>。
 */
(function () {
  var TOKEN_KEY = 'blog.token';
  var REMEMBER_KEY = 'blog.remember';

  function ApiError(status, message, payload) {
    this.name = 'ApiError';
    this.status = status;
    this.message = message;
    this.payload = payload || null;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  function getToken() {
    try {
      return (
        window.sessionStorage.getItem(TOKEN_KEY) ||
        window.localStorage.getItem(TOKEN_KEY) ||
        null
      );
    } catch (err) {
      return null;
    }
  }

  function clearToken() {
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(REMEMBER_KEY);
    } catch (err) {
      /* 隐私模式下 Web Storage 可能不可用，忽略 */
    }
  }

  function setToken(token, remember) {
    clearToken();
    try {
      var store = remember ? window.localStorage : window.sessionStorage;
      store.setItem(TOKEN_KEY, token);
      if (remember) window.localStorage.setItem(REMEMBER_KEY, '1');
    } catch (err) {
      /* 存储不可用时本次会话仍可正常进行 */
    }
  }

  async function request(path, options) {
    var opts = options || {};
    var cfg = window.BLOG_CONFIG || { API_BASE: '' };
    var headers = { 'Content-Type': 'application/json' };

    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (key) {
        headers[key] = opts.headers[key];
      });
    }

    var response;
    try {
      response = await fetch(cfg.API_BASE + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body === undefined ? undefined : opts.body,
        credentials: 'omit',
      });
    } catch (err) {
      throw new ApiError(0, '无法连接后端服务，请确认 Spring Boot 后端 8081 端口已启动，或检查跨域与网络代理配置');
    }

    var payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new ApiError(response.status, '服务端返回格式异常');
    }

    if (!response.ok || payload.ok === false) {
      throw new ApiError(
        response.status,
        payload.message || '请求失败（HTTP ' + response.status + '）',
        payload
      );
    }
    return payload;
  }

  function jsonBody(data) {
    return JSON.stringify(data);
  }

  function qs(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null && v !== '') parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  // 文件上传：multipart/form-data，由浏览器自动设置 Content-Type 与边界，不手动指定。
  function upload(path, file, fieldName) {
    var cfg = window.BLOG_CONFIG || { API_BASE: '' };
    var form = new FormData();
    form.append(fieldName || 'file', file);
    var headers = {};
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(cfg.API_BASE + path, {
      method: 'POST',
      headers: headers,
      body: form,
      credentials: 'omit',
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || payload.ok === false) {
          throw new ApiError(response.status, payload.message || '上传失败', payload);
        }
        return payload;
      });
    });
  }

  window.BlogAuthStore = {
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
  };

  window.ApiError = ApiError;

  window.BlogApi = {
    health: function () {
      return request('/api/health');
    },
    register: function (data) {
      return request('/api/register', { method: 'POST', body: jsonBody(data) });
    },
    login: function (data) {
      return request('/api/login', { method: 'POST', body: jsonBody(data) });
    },
    me: function () {
      return request('/api/me');
    },
    logout: function () {
      return request('/api/logout', { method: 'POST', body: '{}' });
    },
    siteConfig: function () {
      return request('/api/site/config');
    },

    /* ---------- P2：F1 主页聚合 ---------- */
    homeSummary: function (limit) {
      return request('/api/home/summary' + qs({ limit: limit }));
    },

    /* ---------- P2：F2 文章 ---------- */
    listArticles: function (params) {
      return request('/api/articles' + qs(params || {}));
    },
    getArticle: function (id) {
      return request('/api/articles/' + encodeURIComponent(id));
    },
    createArticle: function (data) {
      return request('/api/articles', { method: 'POST', body: jsonBody(data) });
    },
    updateArticle: function (id, data) {
      return request('/api/articles/' + encodeURIComponent(id), { method: 'PUT', body: jsonBody(data) });
    },
    deleteArticle: function (id) {
      return request('/api/articles/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    listCategories: function () {
      return request('/api/categories');
    },
    createCategory: function (data) {
      return request('/api/categories', { method: 'POST', body: jsonBody(data) });
    },
    listTags: function () {
      return request('/api/tags');
    },
    previewMarkdown: function (md) {
      return request('/api/markdown/preview', { method: 'POST', body: jsonBody({ md: md || '' }) });
    },

    /* ---------- P2：F6 资料 ---------- */
    getProfile: function () {
      return request('/api/profile');
    },
    updateProfile: function (data) {
      return request('/api/profile', { method: 'PUT', body: jsonBody(data) });
    },
    getPublicProfile: function (id) {
      return request('/api/profile/' + encodeURIComponent(id));
    },
    uploadAvatar: function (file) {
      return upload('/api/profile/avatar', file, 'file');
    },

    /* ---------- P2：F8 互动 ---------- */
    listComments: function (targetType, targetId, params) {
      return request('/api/comments' + qs(Object.assign({ target_type: targetType, target_id: targetId }, params || {})));
    },
    createComment: function (data) {
      return request('/api/comments', { method: 'POST', body: jsonBody(data) });
    },
    deleteComment: function (id) {
      return request('/api/comments/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    getReactions: function (targetType, targetId) {
      return request('/api/reactions' + qs({ target_type: targetType, target_id: targetId }));
    },
    addReaction: function (data) {
      return request('/api/reactions', { method: 'POST', body: jsonBody(data) });
    },
    removeReaction: function (data) {
      // DELETE 用 query 传参：部分代理会丢弃 DELETE 请求体
      return request('/api/reactions' + qs({
        target_type: data.target_type,
        target_id: data.target_id,
        type: data.type,
      }), { method: 'DELETE' });
    },
    createShare: function (data) {
      return request('/api/shares', { method: 'POST', body: jsonBody(data) });
    },
    revokeShare: function (id) {
      return request('/api/shares/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    getShare: function (token, password) {
      return request('/api/s/' + encodeURIComponent(token) + qs({ password: password }));
    },

    /* ---------- P3：F3 影视资源 ---------- */
    listMedia: function (params) {
      return request('/api/media' + qs(params || {}));
    },
    createMedia: function (data) {
      return request('/api/media', { method: 'POST', body: jsonBody(data) });
    },
    getMedia: function (id) {
      return request('/api/media/' + encodeURIComponent(id));
    },
    updateMedia: function (id, data) {
      return request('/api/media/' + encodeURIComponent(id), { method: 'PUT', body: jsonBody(data) });
    },
    deleteMedia: function (id) {
      return request('/api/media/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    patchMediaStatus: function (id, data) {
      return request('/api/media/' + encodeURIComponent(id) + '/status', { method: 'PATCH', body: jsonBody(data) });
    },

    /* ---------- P3：F4 宝库 ---------- */
    listCollections: function (params) {
      return request('/api/collections' + qs(params || {}));
    },
    createCollection: function (data) {
      return request('/api/collections', { method: 'POST', body: jsonBody(data) });
    },
    getCollection: function (id) {
      return request('/api/collections/' + encodeURIComponent(id));
    },
    updateCollection: function (id, data) {
      return request('/api/collections/' + encodeURIComponent(id), { method: 'PUT', body: jsonBody(data) });
    },
    deleteCollection: function (id) {
      return request('/api/collections/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    listCollectionItems: function (id, params) {
      return request('/api/collections/' + encodeURIComponent(id) + '/items' + qs(params || {}));
    },
    createCollectionItem: function (id, data) {
      return request('/api/collections/' + encodeURIComponent(id) + '/items', { method: 'POST', body: jsonBody(data) });
    },
    updateCollectionItem: function (id, itemId, data) {
      return request('/api/collections/' + encodeURIComponent(id) + '/items/' + encodeURIComponent(itemId), { method: 'PUT', body: jsonBody(data) });
    },
    deleteCollectionItem: function (id, itemId) {
      return request('/api/collections/' + encodeURIComponent(id) + '/items/' + encodeURIComponent(itemId), { method: 'DELETE' });
    },
    setCollectionOrder: function (id, ids) {
      return request('/api/collections/' + encodeURIComponent(id) + '/items/order', { method: 'POST', body: jsonBody({ ids: ids }) });
    },
    moveCollectionItems: function (fromId, toId, ids) {
      return request('/api/collections/' + encodeURIComponent(fromId) + '/items/move', { method: 'POST', body: jsonBody({ toCollectionId: toId, ids: ids }) });
    },
    getPublicCollection: function (id, password) {
      return request('/api/collections/' + encodeURIComponent(id) + '/public' + qs({ password: password }));
    },

    /* ---------- P3：F5 碎碎念 ---------- */
    listMoments: function (params) {
      return request('/api/moments' + qs(params || {}));
    },
    createMoment: function (data) {
      return request('/api/moments', { method: 'POST', body: jsonBody(data) });
    },
    updateMoment: function (id, data) {
      return request('/api/moments/' + encodeURIComponent(id), { method: 'PATCH', body: jsonBody(data) });
    },
    deleteMoment: function (id) {
      return request('/api/moments/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    momentArchive: function () {
      return request('/api/moments/archive');
    },

    /* ---------- P3：F0/F7 账号设置 ---------- */
    listSessions: function () {
      return request('/api/account/sessions');
    },
    revokeSession: function (token) {
      return request('/api/account/sessions/' + encodeURIComponent(token), { method: 'DELETE' });
    },
    revokeOtherSessions: function () {
      return request('/api/account/sessions/logout-others', { method: 'POST', body: '{}' });
    },
    loginLogs: function (params) {
      return request('/api/account/login-logs' + qs(params || {}));
    },
    changePassword: function (data) {
      return request('/api/account/password', { method: 'POST', body: jsonBody(data) });
    },
    getPreferences: function () {
      return request('/api/account/preferences');
    },
    updatePreferences: function (data) {
      return request('/api/account/preferences', { method: 'PUT', body: jsonBody(data) });
    },
    exportData: function () {
      return request('/api/account/export');
    },
    deleteAccount: function () {
      return request('/api/account/delete', { method: 'POST', body: '{}' });
    },
  };
})();
