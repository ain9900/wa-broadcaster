from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models


class Rotation(models.TextChoices):
    """How a campaign shares contacts between its sender accounts."""

    TURNS = "turns", "Take turns"  # one account sends N in a row, then the next one
    RANDOM = "random", "Random"
    BALANCED = "balanced", "Fewest sent today"


class AppSettings(models.Model):
    """Workspace-wide defaults. Always a single row (pk=1)."""

    daily_limit = models.PositiveIntegerField(
        default=0, validators=[MaxValueValidator(10000)], help_text="Messages per account per day. 0 = no limit."
    )
    delay_min_seconds = models.PositiveIntegerField(default=10, validators=[MinValueValidator(3), MaxValueValidator(600)])
    delay_max_seconds = models.PositiveIntegerField(default=25, validators=[MinValueValidator(3), MaxValueValidator(600)])
    batch_size = models.PositiveIntegerField(default=10, validators=[MaxValueValidator(500)])
    batch_pause_minutes = models.PositiveIntegerField(default=5, validators=[MinValueValidator(1), MaxValueValidator(240)])
    typing_indicator = models.BooleanField(default=True, help_text='Show "typing…" briefly before each message.')
    default_country_code = models.CharField(
        max_length=4, blank=True, default="880",
        validators=[RegexValidator(r"^\d{0,4}$", "Digits only, e.g. 880")],
        help_text="Added to local numbers that start with 0 (e.g. 017… becomes 88017…).",
    )
    rotation_mode = models.CharField(max_length=10, choices=Rotation.choices, default=Rotation.TURNS)
    rotate_every = models.PositiveIntegerField(
        default=1, validators=[MinValueValidator(1), MaxValueValidator(100)],
        help_text="With Take turns: messages each account sends before the next one takes over.",
    )
    failover = models.BooleanField(
        default=True, help_text="If an account disconnects or reaches its daily limit, another one takes over.",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = verbose_name_plural = "settings"

    def __str__(self):
        return "Settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
