from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.backend.api.deps import get_client_ip, require_permission
from app.backend.db import get_db
from app.backend.models.customer import Customer
from app.backend.models.user import User
from app.backend.services import audit
from app.backend.services.serializers import serialize_customer

router = APIRouter(prefix="/customers", tags=["customers"])


class CustomerIn(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    address: str = Field(default="", max_length=512)
    note: str = Field(default="", max_length=4096)


@router.get("")
def list_customers(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("customers.read")),
):
    customers = db.query(Customer).order_by(Customer.name).all()
    return [serialize_customer(c) for c in customers]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_customer(
    body: CustomerIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("customers.write")),
    ip: str | None = Depends(get_client_ip),
):
    customer = Customer(name=body.name, address=body.address, note=body.note)
    db.add(customer)
    db.commit()
    audit.record(
        action="CUSTOMER_CREATED",
        user=actor,
        entity="customer",
        entity_id=customer.id,
        ip=ip,
        after={"name": customer.name},
    )
    return serialize_customer(customer)


@router.patch("/{customer_id}")
def update_customer(
    customer_id: str,
    body: CustomerIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("customers.write")),
    ip: str | None = Depends(get_client_ip),
):
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kunde nicht gefunden")
    before = {"name": customer.name, "address": customer.address}
    customer.name = body.name
    customer.address = body.address
    customer.note = body.note
    db.commit()
    audit.record(
        action="CUSTOMER_UPDATED",
        user=actor,
        entity="customer",
        entity_id=customer.id,
        ip=ip,
        before=before,
        after={"name": customer.name, "address": customer.address},
    )
    return serialize_customer(customer)
