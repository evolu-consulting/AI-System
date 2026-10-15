# SHIM UAT (không phải code sản phẩm): lách BUG1 (report.py `body()` gửi "detail": null, Hub zod `.optional()` từ chối ⇒ 400)
# để UAT đi tiếp các kịch bản. Bỏ khoá `detail` khi null.
try:
    import agent_runtime.apply.report as _r

    _orig = _r.ApplyReport.body

    def _body(self):
        d = _orig(self)
        if d.get("detail") is None:
            d.pop("detail", None)
        return d

    _r.ApplyReport.body = _body
except Exception as e:  # noqa
    print("uat-shim lỗi:", e)
