# Adis API — предварительный контракт v0.1

Base URL: `https://api.adis.app/v1` (настраивается в приложении). JSON, UTF-8. Авторизация: `Authorization: Bearer <accessToken>`. Клиент также передаёт заголовки `X-Timezone` и `X-Client`.

Ошибки: HTTP-статус + `{ "detail": "сообщение" }`. Клиент сопоставляет статусы так: 401 → `unauthorized` (обновить токен и повторить запрос; на `/auth/*` это неверные данные входа, код `validation`), 403 → `forbidden`, 404 → `not_found`, 409 → `conflict`, 400/422 → `validation`, 429 → `rate_limited`, 502 → `ai_unavailable` (языковая модель недоступна), 5xx → `server`.

Реализация: `server/` (FastAPI). `GET /v1/health` → `{status, version, engine: 'rules'|'llm', model}`. OpenAPI: `/v1/docs`.

## Auth
| Метод | Путь | Тело / ответ |
|---|---|---|
| POST | /auth/register | `{name,email,password}` → `{accessToken,refreshToken,expiresIn,user}` |
| POST | /auth/login | `{email,password}` → то же |
| POST | /auth/refresh | `{refreshToken}` → то же (refresh одноразовый) |
| POST | /auth/logout | `{refreshToken}` |
| POST | /auth/password/forgot* | `{email}` |
| POST | /auth/password/change* | `{current,next}` |
| GET | /users/me | `User {id,name,email,assistantName,avatar,createdAt}` |
| PATCH | /users/me* | `{name?,assistantName?,avatar?}` |
| DELETE | /users/me* | удаление аккаунта и всех данных |
| GET | /users/me/devices* | `[{id,name,lastActiveAt,current}]` |
| GET | /users/me/export* | полный экспорт данных |

## Chat
| Метод | Путь | Описание |
|---|---|---|
| POST | /chat/messages | `{conversationId?, content, attachments?[{name,size,type,text?}], clientMessageId, source:'text'|'voice', regenerate?, autoSave?, sensitiveGuard?}` → `{conversation, userMessage, assistantMessage}` |
| POST | /chat/stream | то же тело; ответ — SSE `data: {json}` с событиями `start{conversation,userMessage,messageId}`, `status{text,tool?}`, `delta{text}`, `done{message,conversation}`, `error{message}` |
| GET | /chat/conversations | `[{id,title,updatedAt,lastMessage,count}]` |
| GET | /chat/conversations/{id} | `{id,title,messages:[Message]}` |
| DELETE | /chat/conversations/{id}* | |
| PATCH | /chat/conversations/{id}/messages/{mid}/cards/{cid}* | `{status:'confirmed'|'dismissed', result?, data?}` |

`clientMessageId` защищает от повторной отправки: при повторе сервер отвечает 409.

`Message.cards[]`: `{id, type:'memory_save'|'task_create'|'people'|'memories'|'tasks'|'open', status:'pending'|'confirmed'|'dismissed'|'info', data}`.

## Memory
| Метод | Путь |
|---|---|
| GET | /memory?type=&personId= |
| POST | /memory `{type,title,content,tags[],confirmed,personId?,source{kind,excerpt,conversationId,messageId}}` |
| GET | /memory/search?q=&type= (pgvector + полнотекстовый поиск) |
| PATCH | /memory/{id} |
| DELETE | /memory/{id} |

`type`: `fact | assumption | intention | plan | event | preference | idea | knowledge`.

## People* (entity_lookup)
`GET /people`, `POST /people` (при совпадении `id`/имени — слияние, `interaction` добавляется в историю), `GET/PATCH/DELETE /people/{id}`.
`Person {id,name,photo,profession,skills[],organization,metAt,metWhere,notes,interactions[{date,text}]}`.

## Tasks
`GET /tasks`, `POST /tasks {title,notes,dueAt,repeat:'none'|'daily'|'weekly'|'monthly',remind,personId,timezone}`, `PATCH /tasks/{id}` (`{done}` выполняет задачу; у повторяющейся создаётся следующее вхождение), `DELETE /tasks/{id}`. Ответ содержит вычисленный `status: active|overdue|done`.

## Events*
`GET/POST /events`, `PATCH/DELETE /events/{id}` — `{title,startAt,endAt,location,notes,remindMinutes}`.

## Proactive
`GET /proactive/suggestions?frequency=off|rare|normal` → `[{id,kind,title,text,action{type,…},actionLabel,icon}]`
`POST /proactive/{id}/accept`, `POST /proactive/{id}/dismiss`, `POST /proactive/{id}/snooze* {hours}`.

## Agents* / Documents*
`GET/POST /agents`, `PATCH/DELETE /agents/{id}`, `POST /agents/{id}/runs`, `GET /agents/{id}/runs`, `POST /agents/runs/{id}/stop`.
`GET/POST /documents`, `PATCH/DELETE /documents/{id}`.

`*` — расширения сверх ТЗ §9, они нужны реализованным экранам.

## Calendar sync*
| Метод | Путь | Описание |
|---|---|---|
| GET | /calendar/feed | `{enabled, url?, webcal?, public?}` |
| POST | /calendar/feed | включить или сменить секретную ссылку-подписку (старая перестаёт работать) |
| DELETE | /calendar/feed | отключить подписку |
| GET | /calendar/feed/{token}.ics | iCalendar без авторизации (токен в ссылке): события + задачи со сроком, `VALARM` из `remindMinutes` |
| POST | /calendar/import | `{ics}` → `{created, updated, skipped, recurring}`; повторный импорт обновляет события по `UID` |

`Event` дополнительно: `personId`, `imported`.

## Alarms*
`GET/POST /alarms`, `PATCH/DELETE /alarms/{id}`, `POST /alarms/{id}/dismiss`, `POST /alarms/{id}/snooze {minutes}`.
`Alarm {id, hour, minute, time:'HH:MM', days:[0..6] (0 = воскресенье, пусто = один раз), daysLabel, label, enabled, timezone, nextAt, snoozeUntil, ringAt, ringing}`.
Сервер сам «прозванивает» будильник в `nextAt`: ставит `ringAt`, шлёт push, считает следующее срабатывание. Разовый будильник после звонка выключается.

## Push*
`GET /push/vapid-key` → `{publicKey}` (applicationServerKey), `POST /push/subscriptions {endpoint, keys:{p256dh, auth}}`, `POST /push/unsubscribe {endpoint}`, `POST /push/test` (404, если нет подписанных устройств).
Payload, который получает service worker: `{title, body, route, tag, alarm?}`.

## Карточки чата (дополнение)
`event_create {title, startAt, endAt, location, remindMinutes, personId, personName, conflicts[]}`, `event_update {eventId, title, oldStartAt, oldEndAt, startAt?, endAt?, cancel?}`, `alarm_set {hour, minute, days, daysLabel, label}`, `alarm_update {alarmId, time, enabled}`.
Клиент подтверждает их обычными запросами: `POST /events`, `PATCH`/`DELETE /events/{id}`, `POST /alarms`, `PATCH /alarms/{id}`.

## Voice*
`GET /voice/status` → `{enabled, stt, tts, voices[], defaultVoice}`.
`POST /voice/transcribe?lang=ru` — тело запроса: сама запись (`Content-Type: audio/webm | audio/mp4 | audio/ogg | audio/mpeg | audio/wav`, до 15 МБ) → `{text}`. Имена людей пользователя передаются модели как подсказка; числа, время и телефоны распознаются цифрами.
`POST /voice/speak {text, voice?, speed?}` → `audio/mpeg`. Markdown и код из текста убираются, до 1500 символов.
Ограничение: 120 голосовых запросов на пользователя за 10 минут (429).
