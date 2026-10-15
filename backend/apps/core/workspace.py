"""Whose data a signed-in user works with.

Every record belongs to a workspace owner. A team member (employee / support assistant) works in
their owner's workspace; everyone else works in their own.
"""
from rest_framework.permissions import BasePermission


def workspace_of(user):
    membership = getattr(user, "team_membership", None) if user and user.is_authenticated else None
    return membership.owner if membership else user


def is_team_member(user) -> bool:
    return workspace_of(user) != user


class WorkspaceMixin:
    """For DRF views: self.workspace is the owner whose records this request may see and change."""

    @property
    def workspace(self):
        return workspace_of(self.request.user)


class IsWorkspaceOwner(BasePermission):
    """Team management and password changes: not for team members."""

    message = "Only the workspace owner can do this."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and not is_team_member(request.user))
