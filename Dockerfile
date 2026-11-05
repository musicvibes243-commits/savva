# Сайт «Автовоз-312» для Timeweb App Platform (тип Dockerfile).
# Обычный nginx раздаёт статические файлы из папки avtovoz/ — собирать нечего.
FROM nginx:1.27-alpine

COPY deploy/avtovoz-nginx.conf /etc/nginx/conf.d/default.conf
COPY avtovoz/ /usr/share/nginx/html/

EXPOSE 80
