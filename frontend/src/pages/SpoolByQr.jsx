import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import SpoolCard from "../components/SpoolCard.jsx";
import { t } from "../i18n.js";

export default function SpoolByQr() {
  const { token } = useParams();
  const [card, setCard] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get(`/api/spools/by-qr/${token}`)
      .then(setCard)
      .catch((e) => setError(e.message));
  }, [token]);

  if (error) return <div className="card"><div className="error">{error}</div></div>;
  if (!card) return <div>{t("Загрузка…")}</div>;

  return (
    <div>
      <h2>{t("Катушка")}</h2>
      <SpoolCard data={card} />
      <div style={{ marginTop: 16 }}>
        <Link to={`/spools/${card.spool_id}`}>{t("→ Открыть полную страницу катушки")}</Link>
      </div>
    </div>
  );
}
