# Автовоз-312: Netlify + домен avtovoz312.ru (Timeweb)

Сайт лежит в папке `avtovoz/`. Файл `netlify.toml` в корне уже говорит Netlify
публиковать только эту папку — ничего собирать не нужно.

## 1. Купить домен на Timeweb

1. <https://timeweb.com> → **Домены** → ввести `avtovoz312.ru` → **Купить**.
2. Для домена .ru нужны паспортные данные владельца — так требует регистратор.
3. Хостинг на Timeweb **не нужен**: сайт будет жить на Netlify.

## 2. Подключить сайт на Netlify

1. <https://app.netlify.com> → **Sign up with GitHub**.
2. **Add new site → Import an existing project → GitHub**.
3. Разрешить доступ к репозиторию `musicvibes243-commits/savva` и выбрать его.
4. **Branch to deploy:** `main`. Остальные поля Netlify заполнит сам из
   `netlify.toml` (Publish directory — `avtovoz`, Build command — пусто).
5. **Deploy**. Через минуту сайт откроется по адресу вида
   `something.netlify.app` — проверить, что это автовоз, а не кофейня.
6. **Site configuration → Change site name** → например `avtovoz312`
   → адрес станет `avtovoz312.netlify.app`.

## 3. Привязать домен

### В Netlify
**Domain management → Add a domain** → `avtovoz312.ru` → **Verify → Add domain**.
Netlify предложит добавить и `www.avtovoz312.ru` — согласиться.

### В Timeweb
**Домены → avtovoz312.ru → DNS** (Управление DNS). Удалить старые записи `A`
для `@` и `www`, если они есть, и добавить:

| Тип   | Имя (поддомен) | Значение                  |
|-------|----------------|---------------------------|
| A     | `@`            | `75.2.60.5`               |
| CNAME | `www`          | `avtovoz312.netlify.app`  |

(`avtovoz312.netlify.app` — заменить на свой адрес из шага 2.6, если имя другое.)

Записи расходятся от нескольких минут до суток.

## 4. HTTPS

Когда в Netlify напротив домена появится зелёная галочка, открыть
**Domain management → HTTPS → Verify DNS configuration → Provision certificate**.
Обычно Netlify делает это сам. После этого сайт работает по
<https://avtovoz312.ru>.

## Обновления

Каждый `git push` в `main` — и Netlify сам выкладывает новую версию сайта.

## Проверка

- <https://avtovoz312.ru> открывается, глобус крутится, видео играют;
- `http://` и `www.` перебрасывают на `https://avtovoz312.ru`;
- ссылка, отправленная в WhatsApp/Telegram, показывает карточку с картинкой;
- сайт открывается с телефона по мобильному интернету.
