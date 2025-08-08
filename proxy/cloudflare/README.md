# Cloudflare Workers Proxy for CBR XML

Простой и безопасный прокси, который пробрасывает запросы к `www.cbr.ru` и добавляет CORS заголовки.

## Деплой

1. Установите Wrangler:
```bash
npm i -g wrangler
```
2. Авторизуйтесь:
```bash
wrangler login
```
3. Перейдите в каталог воркера и деплойте:
```bash
cd proxy/cloudflare
wrangler deploy
```
4. Получите URL воркера из вывода (`https://<subdomain>.workers.dev`).

## Подключение в приложении

В `cbrf.html` перед подключением `script.js` укажите базовый URL прокси:

```html
<script>
  window.__CBRF_PROXY_BASE__ = 'https://<your-workers-subdomain>.workers.dev';
</script>
<script src="script.js"></script>
```

Скрипт сам сформирует запрос вида: `https://<workers>/proxy?url=<ENCODED_TARGET>`.

## Безопасность
- Пропускаются только запросы к хосту `www.cbr.ru`.
- Встроенный таймаут 10 секунд.
- Возвращает содержимое как есть, устанавливая `Content-Type: text/xml; charset=windows-1251`, если заголовок не пришёл от апстрима.
