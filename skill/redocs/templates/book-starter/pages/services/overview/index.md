# Services

> TODO(owner): List the services and what each one owns.

Every service is registered once in `entities/services.json` (id `svc:<name>`). The generated
**Catalog** pages list them automatically per milestone, so this page should explain the
*why*: boundaries, ownership, and how services are grouped.

Give a service its own page (`redocs add-page <book> services/<name> --kind service`) when it
needs more than a paragraph: responsibilities, API surface, data it owns, scaling notes.
