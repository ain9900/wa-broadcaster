from django.db import transaction
from django.db.models import Count, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.core.csvutil import csv_response
from apps.core.models import AppSettings
from apps.core.workspace import WorkspaceMixin

from .models import Contact, ContactList
from .phones import parse_lines
from .validation import summary as validation_summary
from .serializers import BulkSerializer, ContactListSerializer, ContactSerializer, ImportSerializer


class ContactPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 500


def filtered_contacts(owner, params):
    qs = Contact.objects.filter(owner=owner)
    q = (params.get("q") or "").strip()
    if q:
        digits = "".join(ch for ch in q if ch.isdigit())
        cond = Q(name__icontains=q)
        if digits:
            cond |= Q(phone__contains=digits)
        qs = qs.filter(cond)
    if params.get("list"):
        qs = qs.filter(lists__id=params["list"])
    if params.get("opted_out") in ("true", "false"):
        qs = qs.filter(opted_out=params["opted_out"] == "true")
    valid = params.get("valid")
    if valid == "yes":
        qs = qs.filter(on_whatsapp=True)
    elif valid == "no":
        qs = qs.filter(on_whatsapp=False)
    elif valid == "pending":
        qs = qs.filter(checked_at__isnull=True, opted_out=False)
    return qs


class ContactViewSet(WorkspaceMixin, viewsets.ModelViewSet):
    serializer_class = ContactSerializer
    pagination_class = ContactPagination

    def get_queryset(self):
        return filtered_contacts(self.workspace, self.request.query_params).prefetch_related("lists")

    def perform_create(self, serializer):
        serializer.save(owner=self.workspace)

    @action(detail=False, methods=["get"])
    def ids(self, request):
        """Every id matching the current filters (for "select all")."""
        return Response(list(filtered_contacts(self.workspace, request.query_params).values_list("id", flat=True)[:50000]))

    @action(detail=False, methods=["get"])
    def export(self, request):
        """Contacts matching the current filters as CSV (same columns the importer reads back)."""
        qs = filtered_contacts(self.workspace, request.query_params).prefetch_related("lists").order_by("name", "phone")
        rows = ([c.name, "+" + c.phone, ", ".join(l.name for l in c.lists.all()), "yes" if c.opted_out else "",
                 {True: "yes", False: "no", None: "not checked yet"}[c.on_whatsapp], c.checked_at]
                for c in qs.iterator(chunk_size=2000))
        return csv_response("contacts.csv", ["Name", "Phone", "Lists", "Opted out", "On WhatsApp", "Checked"], rows)

    @action(detail=False, methods=["post"], url_path="import")
    def import_contacts(self, request):
        s = ImportSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        ws = self.workspace
        cc = AppSettings.load(ws).default_country_code

        target_list = None
        if d.get("new_list", "").strip():
            target_list = (ContactList.objects.filter(owner=ws, name__iexact=d["new_list"].strip()).first()
                           or ContactList.objects.create(owner=ws, name=d["new_list"].strip()))
        elif d.get("list_id"):
            target_list = ContactList.objects.filter(pk=d["list_id"], owner=ws).first()

        rows, invalid, columns = {}, [], {}
        for line_no, phone, name, raw in parse_lines(d["text"], cc, columns):
            if not phone:
                if not (line_no == 1 and not any(ch.isdigit() for ch in raw)):  # skip a header row quietly
                    invalid.append({"line": line_no, "text": raw[:80]})
                continue
            if phone not in rows or (name and not rows[phone]):
                rows[phone] = name

        created = updated = 0
        with transaction.atomic():
            mine = Contact.objects.filter(owner=ws)
            existing = {c.phone: c for c in mine.filter(phone__in=rows)}
            new = [Contact(owner=ws, phone=p, name=n) for p, n in rows.items() if p not in existing]
            Contact.objects.bulk_create(new, batch_size=1000)
            created = len(new)
            if d["update_names"]:
                changed = [c for p, c in existing.items() if rows[p] and c.name != rows[p]]
                for c in changed:
                    c.name = rows[c.phone]
                Contact.objects.bulk_update(changed, ["name"], batch_size=1000)
                updated = len(changed)
            if target_list:
                target_list.contacts.add(*mine.filter(phone__in=rows).values_list("id", flat=True))
        imported = mine.filter(phone__in=rows)
        return Response({
            "total": len(rows), "created": created, "updated": updated, "invalid": invalid[:200],
            "invalid_count": len(invalid), "list": ContactListSerializer(target_list).data if target_list else None,
            "validation": validation_summary(imported),
            "columns": columns or None,
            # Letters lost before upload (e.g. Bangla in a CSV that Excel saved without UTF-8) arrive as "???".
            "garbled_names": sum(1 for n in rows.values() if "??" in n),
        })

    @action(detail=False, methods=["get"])
    def validation(self, request):
        """How many numbers (matching the filters) are valid, not on WhatsApp, or still being checked."""
        return Response(validation_summary(filtered_contacts(self.workspace, request.query_params)))

    @action(detail=False, methods=["post"])
    def bulk(self, request):
        s = BulkSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        qs = Contact.objects.filter(owner=self.workspace, pk__in=d["ids"])
        act = d["action"]
        if act == "delete":
            n, _ = qs.delete()
            return Response({"affected": n})
        if act in ("opt_out", "opt_in"):
            return Response({"affected": qs.update(opted_out=act == "opt_out")})
        if act == "recheck":
            return Response({"affected": qs.update(checked_at=None)})
        lst = ContactList.objects.filter(pk=d["list_id"], owner=self.workspace).first()
        if not lst:
            return Response({"error": "That list no longer exists."}, status=status.HTTP_404_NOT_FOUND)
        ids = list(qs.values_list("id", flat=True))
        (lst.contacts.add if act == "add_to_list" else lst.contacts.remove)(*ids)
        return Response({"affected": len(ids)})


class ContactListViewSet(WorkspaceMixin, viewsets.ModelViewSet):
    serializer_class = ContactListSerializer
    pagination_class = None

    def perform_create(self, serializer):
        serializer.save(owner=self.workspace)

    def get_queryset(self):
        return ContactList.objects.filter(owner=self.workspace).annotate(
            contact_count=Count("contacts", filter=Q(contacts__opted_out=False) & ~Q(contacts__on_whatsapp=False)))
