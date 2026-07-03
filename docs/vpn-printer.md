# Доступ к домашнему принтеру с VPS через WireGuard

Если Filament Tracker крутится на VPS (например, в Германии), а принтер стоит
дома, серверу нужно как-то достучаться до принтера в локальной сети
(`http://192.168.0.127`). Прямого пути нет — решаем через WireGuard-туннель между
VPS и домом.

Принтер (Anycubic/Rinkhals и т.п.) — «железка», VPN на неё не поставить. Поэтому
туннель поднимаем на **домашнем шлюзе**: это может быть роутер с OpenWrt,
Raspberry Pi или любой всегда включённый Linux-сервер в домашней сети.

```
VPS (Германия) ──WireGuard-туннель──▶ Домашний шлюз ──локальная сеть──▶ Принтер
 Filament Tracker                     (роутер/Pi/сервер)              192.168.0.127
```

Дальше: **Часть 1** одинакова для всех (настройка VPS). **Часть 2** — выберите
своё устройство под шлюз. **Часть 3–4** — проверка и подключение приложения.

> В примерах:
> - `10.10.0.1` — адрес VPS внутри туннеля, `10.10.0.2` — адрес домашнего шлюза;
> - `192.168.0.0/24` — домашняя сеть, `192.168.0.127` — принтер;
> - `<VPS_PUBLIC_IP>` — публичный IP вашего VPS.
> Подставьте свои значения (особенно домашнюю подсеть — она может быть
> `192.168.1.0/24`, `10.0.0.0/24` и т.д.).

---

## Часть 1. VPS — сервер WireGuard (общая для всех вариантов)

```bash
sudo apt update && sudo apt install -y wireguard

# ключи VPS
wg genkey | sudo tee /etc/wireguard/vps.key | wg pubkey | sudo tee /etc/wireguard/vps.pub
```

Создайте `/etc/wireguard/wg0.conf`:

```ini
[Interface]
Address = 10.10.0.1/24
ListenPort = 51820
PrivateKey = <ПРИВАТНЫЙ_КЛЮЧ_VPS>     # содержимое /etc/wireguard/vps.key

[Peer]
# домашний шлюз (его публичный ключ добавите после Части 2)
PublicKey = <ПУБЛИЧНЫЙ_КЛЮЧ_ДОМА>
# через этот peer доступны и он сам, и вся домашняя подсеть:
AllowedIPs = 10.10.0.2/32, 192.168.0.0/24
```

Строка `AllowedIPs = ...192.168.0.0/24` заставляет VPS автоматически проложить
маршрут к домашней сети через туннель.

Откройте порт и запустите:

```bash
sudo ufw allow 51820/udp          # если используете ufw
# ВАЖНО: откройте UDP 51820 и в облачном firewall/Security Group провайдера VPS
sudo systemctl enable --now wg-quick@wg0
```

VPS настроен. Публичный ключ VPS (`/etc/wireguard/vps.pub`) понадобится на шлюзе.

---

## Часть 2. Домашний шлюз — выберите одно устройство

### Вариант 1. Роутер с OpenWrt (рекомендуется — NAT не нужен)

Роутер уже является шлюзом локальной сети, поэтому принтер будет отвечать ему
напрямую, и дополнительный NAT не требуется — нужно лишь поднять WG-интерфейс и
разрешить пересылку между зонами `wg` и `lan`.

**1. Установить пакеты** (SSH на роутер):

```sh
opkg update
opkg install wireguard-tools luci-proto-wireguard luci-app-wireguard
```

**2. Сгенерировать ключи:**

```sh
wg genkey | tee /tmp/wg.key | wg pubkey > /tmp/wg.pub
cat /tmp/wg.key   # приватный ключ ДОМА
cat /tmp/wg.pub   # публичный ключ ДОМА → вписать в wg0.conf на VPS ([Peer] PublicKey)
```

**3. Создать WG-интерфейс** (через UCI CLI):

```sh
PRIV="$(cat /tmp/wg.key)"

uci set network.wg0=interface
uci set network.wg0.proto='wireguard'
uci set network.wg0.private_key="$PRIV"
uci add_list network.wg0.addresses='10.10.0.2/24'

# peer = VPS
uci set network.wgvps=wireguard_wg0
uci set network.wgvps.public_key='<ПУБЛИЧНЫЙ_КЛЮЧ_VPS>'   # /etc/wireguard/vps.pub
uci set network.wgvps.endpoint_host='<VPS_PUBLIC_IP>'
uci set network.wgvps.endpoint_port='51820'
uci set network.wgvps.persistent_keepalive='25'
uci add_list network.wgvps.allowed_ips='10.10.0.0/24'
uci set network.wgvps.route_allowed_ips='1'

uci commit network
/etc/init.d/network restart
```

**4. Firewall — зона `wg` и пересылка с/на `lan`:**

```sh
uci add firewall zone
uci set firewall.@zone[-1].name='wg'
uci set firewall.@zone[-1].input='ACCEPT'
uci set firewall.@zone[-1].output='ACCEPT'
uci set firewall.@zone[-1].forward='REJECT'
uci add_list firewall.@zone[-1].network='wg0'

# разрешить трафик из туннеля в локалку и обратно
uci add firewall forwarding
uci set firewall.@forwarding[-1].src='wg'
uci set firewall.@forwarding[-1].dest='lan'
uci add firewall forwarding
uci set firewall.@forwarding[-1].src='lan'
uci set firewall.@forwarding[-1].dest='wg'

uci commit firewall
/etc/init.d/firewall restart
```

> **Через веб-интерфейс LuCI** то же самое: *Network → Interfaces → Add new
> interface* (протокол WireGuard, приватный ключ, адрес `10.10.0.2/24`, peer =
> VPS с его публичным ключом, endpoint, `AllowedIPs = 10.10.0.0/24`, галочка
> *Route Allowed IPs*, keepalive 25). Затем *Network → Firewall*: новая зона `wg`
> с интерфейсом `wg0` и разрешённый форвардинг `wg ↔ lan`.

На VPS в `[Peer]` впишите публичный ключ роутера (`/tmp/wg.pub`) и перезапустите
`sudo systemctl restart wg-quick@wg0`. Переходите к Части 3.

---

### Вариант 2. Raspberry Pi / домашний Linux-сервер (нужен NAT)

Здесь шлюз — **не** маршрутизатор сети, поэтому принтер отвечал бы своему обычному
роутеру, который про туннель не знает. Решение — NAT (MASQUERADE) на Pi: принтер
видит запрос «от Pi», отвечает ему, а Pi заворачивает ответ в туннель.

**1. Установка и ключи:**

```bash
sudo apt update && sudo apt install -y wireguard
wg genkey | sudo tee /etc/wireguard/home.key | wg pubkey | sudo tee /etc/wireguard/home.pub
cat /etc/wireguard/home.pub   # публичный ключ ДОМА → в [Peer] на VPS
```

**2. Узнать имя локального интерфейса** (обычно `eth0`, у Wi‑Fi — `wlan0`):

```bash
ip route | grep default        # напр.: default via 192.168.0.1 dev eth0
```

**3. Конфиг `/etc/wireguard/wg0.conf`** (замените `eth0` на своё):

```ini
[Interface]
Address = 10.10.0.2/24
PrivateKey = <ПРИВАТНЫЙ_КЛЮЧ_ДОМА>      # /etc/wireguard/home.key
PostUp   = sysctl -w net.ipv4.ip_forward=1; iptables -t nat -A POSTROUTING -s 10.10.0.0/24 -o eth0 -j MASQUERADE; iptables -A FORWARD -i wg0 -o eth0 -j ACCEPT; iptables -A FORWARD -i eth0 -o wg0 -m state --state RELATED,ESTABLISHED -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -s 10.10.0.0/24 -o eth0 -j MASQUERADE; iptables -D FORWARD -i wg0 -o eth0 -j ACCEPT; iptables -D FORWARD -i eth0 -o wg0 -m state --state RELATED,ESTABLISHED -j ACCEPT

[Peer]
PublicKey = <ПУБЛИЧНЫЙ_КЛЮЧ_VPS>        # /etc/wireguard/vps.pub
Endpoint = <VPS_PUBLIC_IP>:51820
AllowedIPs = 10.10.0.0/24
PersistentKeepalive = 25
```

**4. Запуск:**

```bash
sudo systemctl enable --now wg-quick@wg0
sudo wg      # должно появиться "latest handshake"
```

На VPS впишите публичный ключ Pi в `[Peer]` и `sudo systemctl restart wg-quick@wg0`.

---

### Вариант 3. Любой другой Linux (мини-ПК, NAS, старый ноут)

Полностью совпадает с **Вариантом 2** — это тот же `wg-quick` c NAT. Отличаться
может лишь имя интерфейса (`ip route | grep default`) и способ включить сервис
(на системах без systemd — `sudo wg-quick up wg0` и добавить в автозагрузку).

---

## Часть 3. Проверка

Сначала с **VPS** (с хоста, не из контейнера):

```bash
sudo wg                                   # есть "latest handshake" — туннель поднят
ping -c3 10.10.0.2                         # сам домашний шлюз
ping -c3 192.168.0.127                     # принтер через туннель
curl -s http://192.168.0.127/printer/info  # должен ответить JSON Moonraker
```

Затем из контейнера бэкенда (он ходит наружу через хост, у которого уже есть
маршрут):

```bash
docker compose exec backend curl -s http://192.168.0.127/printer/info
```

Отвечает — можно подключать приложение.

---

## Часть 4. Подключение приложения

1. В приложении → **Принтеры** → добавить/изменить принтер.
2. **Moonraker URL** = `http://192.168.0.127` (реальный локальный IP принтера — он
   теперь доступен через туннель).
3. Нажать **Тест соединения** — должно показать состояние принтера.

Дальше всё как обычно: живой статус печати на главной и списание материала в один
клик работают, потому что для сервера принтер теперь «как локальный».

---

## Диагностика

| Симптом | Причина / решение |
|--------|-------------------|
| Нет `latest handshake` в `sudo wg` | Не открыт UDP 51820 на VPS (в т.ч. в облачном firewall провайдера); неверный `Endpoint`/`<VPS_PUBLIC_IP>`; перепутаны публичные ключи. |
| `ping 10.10.0.2` идёт, `ping 192.168.0.127` — нет | Не разрешена пересылка. OpenWrt: нет forwarding `wg → lan`. Pi: не сработал `MASQUERADE`/`ip_forward` (проверьте имя интерфейса в PostUp). |
| Пинг принтера идёт, а `curl` — нет | Принтер отвечает по HTTP только на определённый origin/порт — проверьте, что URL именно `http://` и порт по умолчанию 80; повторите `curl -v`. |
| С хоста VPS работает, из контейнера — нет | Firewall хоста режет docker-подсеть. Разрешите форвардинг для сети Docker или добавьте маршрут; в стандартной установке обычно работает без правок. |
| Туннель рвётся после простоя | На домашней стороне должен быть `PersistentKeepalive = 25` (дом за NAT инициирует соединение). |

---

## Безопасность

- В `AllowedIPs` на VPS для домашнего peer можно указать **только принтер** —
  `AllowedIPs = 10.10.0.2/32, 192.168.0.127/32` — тогда через туннель доступен
  лишь он, а не вся домашняя сеть.
- Приватные ключи (`*.key`) не покидают своё устройство; между сторонами
  обмениваетесь только **публичными** ключами.
- Сам веб-интерфейс на VPS всё равно закройте HTTPS-прокси и смените пароли
  (см. основной README, раздел про доступ из сети).
