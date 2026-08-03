"""
Minimal, dependency-free JSON Schema validator.

Supports the subset of JSON Schema (Draft 2020-12) actually used by this
project's own schemas: type, required, properties, patternProperties,
pattern, const, enum, minItems, maxItems, items, minProperties.

This exists because the environment this tooling was built in has no
network access and cannot install the real `jsonschema` PyPI package.
It intentionally does NOT support the full JSON Schema spec (no $ref
resolution, no allOf/anyOf/oneOf, no format keyword beyond what's
hand-rolled here) — it supports exactly what this project's own three
schema files need, nothing more. If this project's schemas grow to need
more of the spec, either extend this validator or install the real
`jsonschema` package in an environment that has network access.
"""
import re


class SchemaError(Exception):
    def __init__(self, path, message):
        self.path = path
        self.message = message
        super().__init__(f"{path}: {message}")


def _type_ok(value, expected):
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def validate(instance, schema, path="$"):
    """Returns a list of SchemaError. Empty list means valid."""
    errors = []

    if "type" in schema and not _type_ok(instance, schema["type"]):
        errors.append(SchemaError(path, f"expected type '{schema['type']}', got {type(instance).__name__}"))
        return errors  # further checks would be meaningless on a type mismatch

    if "const" in schema and instance != schema["const"]:
        errors.append(SchemaError(path, f"expected constant value {schema['const']!r}, got {instance!r}"))

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(SchemaError(path, f"value {instance!r} not in allowed enum {schema['enum']!r}"))

    if isinstance(instance, str) and "pattern" in schema:
        if not re.match(schema["pattern"], instance):
            errors.append(SchemaError(path, f"string {instance!r} does not match pattern {schema['pattern']!r}"))

    if isinstance(instance, dict):
        for req in schema.get("required", []):
            if req not in instance:
                errors.append(SchemaError(path, f"missing required property '{req}'"))

        if "minProperties" in schema and len(instance) < schema["minProperties"]:
            errors.append(SchemaError(path, f"expected at least {schema['minProperties']} properties, got {len(instance)}"))

        props = schema.get("properties", {})
        for key, subschema in props.items():
            if key in instance:
                errors.extend(validate(instance[key], subschema, f"{path}.{key}"))

        pattern_props = schema.get("patternProperties", {})
        for key, value in instance.items():
            if key in props:
                continue
            for pat, subschema in pattern_props.items():
                if re.match(pat, key):
                    errors.extend(validate(value, subschema, f"{path}.{key}"))

    if isinstance(instance, list):
        if "minItems" in schema and len(instance) < schema["minItems"]:
            errors.append(SchemaError(path, f"expected at least {schema['minItems']} items, got {len(instance)}"))
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            errors.append(SchemaError(path, f"expected at most {schema['maxItems']} items, got {len(instance)}"))
        if "items" in schema:
            for i, item in enumerate(instance):
                errors.extend(validate(item, schema["items"], f"{path}[{i}]"))

    return errors


def validate_or_raise(instance, schema, label=""):
    errors = validate(instance, schema)
    if errors:
        msgs = "\n".join(f"  - {e}" for e in errors)
        raise ValueError(f"{label} failed schema validation:\n{msgs}")
    return True
