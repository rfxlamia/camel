# Creative Brief — Camel

## Brand Persona
- **Character:** Kanban board yang terhubung langsung dengan GitHub issue untuk small dev team
- **Tone of Voice:** Neutral-friendly — clear, warm, plain language, sparing exclamation
- **Emotional Goal:** User should feel productive, terkontrol, terorganisir, terarah, tenang

## Design Tokens
- **Font:** Work Sans
- **Border radius:** 6px (base)
- **Modular scale:** 1.25 (Major Third)
- **Chroma:** 0.08 (muted, calm)
- **Visual references:** Notion, Linear

---

## Color System (OKLCH)

### Primary (Navy/Blue, H=250°, C=0.08)
| Shade | OKLCH | Hex | Contrast vs White |
|---|---|---|---|
| 100 | `oklch(97.0% 0.020 250)` | `#ebf7ff` | bg tint |
| 200 | `oklch(92.0% 0.036 250)` | `#d3e7fc` | bg tint |
| 300 | `oklch(84.0% 0.052 250)` | `#b2ceec` | border |
| 400 | `oklch(74.0% 0.068 250)` | `#8aafd5` | icon |
| 500 | `oklch(64.0% 0.080 250)` | `#6690bb` | large text |
| **600** | `oklch(55.0% 0.076 250)` | `#4e759d` | 4.83:1 ✅ AA |
| **700** | `oklch(46.0% 0.068 250)` | `#3a5b7d` | 7.10:1 ✅ AAA |
| **800** | `oklch(37.0% 0.056 250)` | `#28425c` | 10.40:1 ✅ AAA |
| **900** | `oklch(28.0% 0.044 250)` | `#172a3e` | 14.56:1 ✅ AAA |

### Accent (Warm Orange, H=40°, C=0.08)
| Shade | OKLCH | Hex | Contrast vs White |
|---|---|---|---|
| 100 | `oklch(97.0% 0.020 40)` | `#fff1eb` | bg tint |
| 200 | `oklch(92.0% 0.036 40)` | `#fbddd3` | bg tint |
| 300 | `oklch(84.0% 0.052 40)` | `#eac0b1` | border |
| 400 | `oklch(74.0% 0.068 40)` | `#d19d8b` | icon |
| 500 | `oklch(64.0% 0.080 40)` | `#b67c67` | large text |
| **600** | `oklch(55.0% 0.076 40)` | `#98624f` | 5.01:1 ✅ AA |
| **700** | `oklch(46.0% 0.068 40)` | `#794b3b` | 7.33:1 ✅ AAA |
| **800** | `oklch(37.0% 0.056 40)` | `#593529` | 10.67:1 ✅ AAA |
| **900** | `oklch(28.0% 0.044 40)` | `#3b2118` | 14.80:1 ✅ AAA |

### Neutrals (H=250°, C=0.01 — hint of brand blue)
| Shade | OKLCH | Hex | Use |
|---|---|---|---|
| 100 | `oklch(97.0% 0.003 250)` | `#f4f5f7` | surface |
| 200 | `oklch(92.0% 0.005 250)` | `#e2e5e7` | border, disabled bg |
| 300 | `oklch(84.0% 0.007 250)` | `#c7cbcf` | border |
| 400 | `oklch(74.0% 0.009 250)` | `#a7abb0` | disabled text |
| 500 | `oklch(64.0% 0.010 250)` | `#888d92` | placeholder |
| **600** | `oklch(55.0% 0.009 250)` | `#6d7277` | 4.85:1 ✅ AA |
| **700** | `oklch(46.0% 0.009 250)` | `#55585d` | 7.12:1 ✅ AAA |
| **800** | `oklch(37.0% 0.007 250)` | `#3d4043` | 10.42:1 ✅ AAA |
| **900** | `oklch(28.0% 0.006 250)` | `#27292c` | 14.59:1 ✅ AAA |

### Semantic Colors
| Role | BG Tint | Solid | Text | Text-on-BG | White-on-Solid |
|---|---|---|---|---|---|
| **Success** | `oklch(95% 0.025 145)` `#e5f3e4` | `oklch(55% 0.100 145)` `#49814c` | `oklch(35% 0.085 145)` `#18461c` | 9.52:1 ✅ AAA | 4.65:1 ✅ AA |
| **Warning** | `oklch(95% 0.025 85)` `#f6eedc` | `oklch(55% 0.100 85)` `#8c6c1f` | `oklch(35% 0.085 85)` `#4f3600` | 9.81:1 ✅ AAA | 4.89:1 ✅ AA |
| **Error** | `oklch(95% 0.025 25)` `#ffe8e6` | `oklch(55% 0.100 25)` `#a45953` | `oklch(35% 0.085 25)` `#5f2623` | 10.08:1 ✅ AAA | 5.09:1 ✅ AA |
| **Info** | `oklch(95% 0.020 245)` `#e4f0fb` | `oklch(55% 0.080 245)` `#47769d` | `oklch(35% 0.068 245)` `#173e5b` | 9.74:1 ✅ AAA | 4.81:1 ✅ AA |

---

## Typography Scale

**Font:** Work Sans | **Base:** 16px | **Ratio:** 1.25 (Major Third)

| Name | Size | Line-height | Use |
|---|---|---|---|
| xs | 10px | 1.5 | helper text, meta |
| sm | 13px | 1.5 | labels, captions |
| **base** | 16px | 1.5 | body text |
| md | 20px | 1.3 | subheadings |
| lg | 25px | 1.3 | section headings |
| xl | 31px | 1.2 | page headings |
| 2xl | 39px | 1.2 | hero text |
| 3xl | 49px | 1.2 | display |

---

## Atoms

### Button — Primary
| State | Background | Text | Border | Shadow | Cursor | Focus ring |
|---|---|---|---|---|---|---|
| Default | `oklch(55.0% 0.076 250)` — primary-600 | white | none | `0 1px 2px rgba(0,0,0,0.1)` | pointer | — |
| Hover | `oklch(46.0% 0.068 250)` — primary-700 | white | none | `0 2px 4px rgba(0,0,0,0.15)` | pointer | — |
| Focus | `oklch(55.0% 0.076 250)` — primary-600 | white | none | `0 1px 2px rgba(0,0,0,0.1)` | pointer | `2px solid primary-600, offset 2px` |
| Disabled | `oklch(92.0% 0.005 250)` — neutral-200 | `oklch(74.0% 0.009 250)` — neutral-400 | none | none | not-allowed | — |
| Error | `oklch(55.0% 0.100 25)` — error-500 | white | none | `0 1px 2px rgba(0,0,0,0.1)` | pointer | — |

Contrast: Default 4.83:1 ✅ AA · Hover 7.10:1 ✅ AAA · Error 5.09:1 ✅ AA

### Button — Secondary
| State | Background | Text | Border | Shadow | Cursor | Focus ring |
|---|---|---|---|---|---|---|
| Default | `oklch(97.0% 0.003 250)` — neutral-100 | `oklch(46.0% 0.068 250)` — primary-700 | `1px solid neutral-300` | none | pointer | — |
| Hover | `oklch(92.0% 0.005 250)` — neutral-200 | `oklch(46.0% 0.068 250)` — primary-700 | `1px solid neutral-300` | none | pointer | — |
| Focus | `oklch(97.0% 0.003 250)` — neutral-100 | `oklch(46.0% 0.068 250)` — primary-700 | `1px solid neutral-300` | none | pointer | `2px solid primary-600, offset 2px` |
| Disabled | `oklch(97.0% 0.003 250)` — neutral-100 | `oklch(74.0% 0.009 250)` — neutral-400 | `1px solid neutral-200` | none | not-allowed | — |
| Error | `oklch(95.0% 0.025 25)` — error-100 | `oklch(46.0% 0.068 25)` — error-700 | `1px solid error-500` | none | pointer | — |

Contrast: Default 6.51:1 ✅ AAA · Hover 5.60:1 ✅ AA

### Button — Ghost
| State | Background | Text | Border | Shadow | Cursor | Focus ring |
|---|---|---|---|---|---|---|
| Default | transparent | `oklch(55.0% 0.076 250)` — primary-600 | none | none | pointer | — |
| Hover | `oklch(97.0% 0.020 250)` — primary-100 | `oklch(46.0% 0.068 250)` — primary-700 | none | none | pointer | — |
| Focus | transparent | `oklch(55.0% 0.076 250)` — primary-600 | none | none | pointer | `2px solid primary-600, offset 2px` |
| Disabled | transparent | `oklch(74.0% 0.009 250)` — neutral-400 | none | none | not-allowed | — |
| Error | transparent | `oklch(55.0% 0.100 25)` — error-600 | none | none | pointer | — |

Contrast: Default 4.83:1 ✅ AA · Hover 6.51:1 ✅ AAA

### Input / Text Field
| State | Background | Text | Border | Shadow | Cursor | Focus ring |
|---|---|---|---|---|---|---|
| Default | white | `oklch(28.0% 0.006 250)` — neutral-900 | `1px solid neutral-300` | none | text | — |
| Hover | white | `oklch(28.0% 0.006 250)` — neutral-900 | `1px solid neutral-400` | none | text | — |
| Focus | white | `oklch(28.0% 0.006 250)` — neutral-900 | `1px solid primary-600` | `0 0 0 3px primary-600/15%` | text | `2px solid primary-600, offset 2px` |
| Disabled | `oklch(97.0% 0.003 250)` — neutral-100 | `oklch(74.0% 0.009 250)` — neutral-400 | `1px solid neutral-200` | none | not-allowed | — |
| Error | white | `oklch(28.0% 0.006 250)` — neutral-900 | `1px solid error-500` | `0 0 0 3px error-500/15%` | text | — |

Contrast: Text on white 14.58:1 ✅ AAA

### Badge / Tag
| State | Background | Text | Border | Shadow | Cursor | Focus ring |
|---|---|---|---|---|---|---|
| Default (primary) | `oklch(95.0% 0.020 250)` — primary-100 | `oklch(37.0% 0.056 250)` — primary-800 | none | none | default | — |
| Default (success) | `oklch(95.0% 0.025 145)` | `oklch(35.0% 0.085 145)` | none | none | default | — |
| Default (warning) | `oklch(95.0% 0.025 85)` | `oklch(35.0% 0.085 85)` | none | none | default | — |
| Default (error) | `oklch(95.0% 0.025 25)` | `oklch(35.0% 0.085 25)` | none | none | default | — |
| Hover | slight darken bg | same text | none | none | pointer | — |
| Focus | same bg | same text | none | none | pointer | `2px solid primary-600, offset 2px` |
| Disabled | `oklch(92.0% 0.005 250)` | `oklch(74.0% 0.009 250)` | none | none | not-allowed | — |

Contrast: All text-on-bg pairs ≥ 9.5:1 ✅ AAA

### Link
| State | Background | Text | Border | Shadow | Cursor | Focus ring |
|---|---|---|---|---|---|---|
| Default | transparent | `oklch(55.0% 0.076 250)` — primary-600 | none | none | pointer | — |
| Hover | transparent | `oklch(46.0% 0.068 250)` — primary-700 + underline | none | none | pointer | — |
| Focus | transparent | `oklch(46.0% 0.068 250)` — primary-700 | none | none | pointer | `2px solid primary-600, offset 2px` |
| Disabled | transparent | `oklch(74.0% 0.009 250)` — neutral-400 | none | none | not-allowed | — |
| Error | transparent | `oklch(55.0% 0.100 25)` — error-600 | none | none | pointer | — |

Contrast: Default 4.83:1 ✅ AA · Hover 7.10:1 ✅ AAA

---

## Copy Guidelines

**Register:** Neutral-friendly — clear, warm, plain language

### CTA Style
| Surface | Copy |
|---|---|
| Primary action | "Create project" · "Sync issues" · "Add to board" |
| Secondary action | "Not now" · "Cancel" |

### Error Messages
| Type | Copy |
|---|---|
| Validation | "That name's already taken — try another." |
| Action failed | "Couldn't sync issues. Check your connection and try again." |
| Permission | "You don't have access to this repo." |

### Placeholders
- "Project name"
- "Search issues..."
- "Enter repo URL"

### Empty State
"Nothing here yet. Connect a repo to get started."

### Success Confirmation
"Project created." · "Issues synced."

---

## Molecules (Examples)

### 1. Search Bar = Input + Button(Primary)
- Input in Default state with placeholder "Search issues..."
- Button in Default state with label "Search"

### 2. Form Group = Label + Input + Error Text
- Label: neutral-700 text, sm size
- Input in **Error** state (error-500 border)
- Helper text: error-600 color, xs size
- Example: "That name's already taken — try another."

### 3. Filter Row = Badge ×N + Link("Clear all")
- Badges in Default (primary) state, clickable
- Link in Default state: "Clear all"
