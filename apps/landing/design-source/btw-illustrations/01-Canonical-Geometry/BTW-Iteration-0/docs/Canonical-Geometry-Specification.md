# Iteration 0 --- Canonical Geometry Specification

## Purpose

This document defines the immutable geometric foundation for every BTW
SVG asset.

## Global Coordinate System

-   Base grid: 8 px
-   Origin: (0,0) top-left
-   X grows right
-   Y grows down

## Canonical Units

-   Stroke: 4
-   Small radius: 8
-   Medium radius: 16
-   Large radius: 24

## Hero Reference Frame

ViewBox: 1200×900

Reference points: - Phone center: (360,580) - Scan origin: (360,420) -
Cone angle: 80° - Cone radius: 520

## Camera Rules

Marker size: 28 Minimum spacing: 96 Allowed shapes: circle, drop

## Safe Areas

Hero: 64 px Icons: 12 px OG: left 45%, right 55%

## Alignment Rules

-   All coordinates multiples of 8.
-   All strokes centered on pixel grid.
-   Maximum group nesting: 2.

## Naming

background phone screen hand scan-cone camera-1 camera-2 camera-3
camera-fov-1 camera-fov-2 camera-fov-3

## Acceptance

Every illustration must derive its geometry exclusively from this
specification.
