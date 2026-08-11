import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, gen_uuid


class CostEstimate(Base, TimestampMixin):
    """Сохранённый расчёт стоимости изделия.

    inputs — вся форма целиком, включая тарифы на момент сохранения. Тарифы
    заморожены намеренно: расчёт это коммерческое предложение, и если завтра
    подорожает электричество, отправленная заказчику цена не должна молча
    измениться. Обновить их можно кнопкой на странице.

    totals — разбор, посчитанный сервером при каждой записи (cost_service.compute),
    а не присланный формой. Хранится, чтобы список не гонял калькулятор по всем
    строкам и чтобы правка формулы не переписывала прошлые расчёты задним числом.
    """

    __tablename__ = "cost_estimates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=gen_uuid
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    revision: Mapped[str | None] = mapped_column(String)
    notes: Mapped[str | None] = mapped_column(Text)
    # Чьи параметры пошли в машиночас и из какой печати взяты граммы и время.
    # Обе связи необязательные: расчёт можно вести и с чистого листа.
    printer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("printers.id")
    )
    print_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("print_jobs.id")
    )
    currency: Mapped[str] = mapped_column(String, nullable=False, default="RUB")
    inputs: Mapped[dict] = mapped_column(JSONB, nullable=False)
    totals: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # Денормализация ради списка: сортировать и показывать итог, не разбирая JSONB.
    landed_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
