# 接口约定

## 统一返回

成功：`{ "success": true, "data": {}, "requestId": "..." }`

失败：`{ "success": false, "error": { "code": "FORBIDDEN", "message": "..." }, "requestId": "..." }`

## 文档接口

- `GET /api/documents`：按角色自动返回可见文档与审计记录。
- `POST /api/documents`：创建资料；`multipart/form-data`，必填 `title/category/owner`。
- `PATCH /api/documents`：状态流转；请求 `{ id, action, comment }`。
- `GET /api/documents/:id`：查看详情和版本。
- `GET /api/documents/:id?download=1`：鉴权后下载附件。
- `PUT /api/documents/:id`：上传人或本部门管理员编辑并产生新版本。
- `POST /api/documents/:id`：提交纠错反馈。
- `DELETE /api/documents/:id`：管理员软删除。
- `DELETE /api/documents/:id?hard=1`：仅超级管理员彻底删除。

所有接口必须登录，并在服务端执行行级权限判断、参数校验、限流和审计。

