# Third-Party Notices

Slate includes open-source software and assets. This file records the primary
third-party projects whose code or assets are included in the distributed
desktop application or browser extension. It is not a substitute for a complete
legal review of every transitive dependency.

## Geist font

- Project: Geist
- Source: <https://github.com/vercel/geist-font>
- Packaged through: `@fontsource-variable/geist` 5.3.0
- License: SIL Open Font License 1.1
- Copyright: 2024 The Geist Project Authors

The font package includes the complete SIL Open Font License 1.1. The license is
available at <https://scripts.sil.org/OFL> and permits bundling the font with
software subject to its terms, including retaining the copyright and license
notices.

## Lucide icons

- Project: Lucide
- Source: <https://github.com/lucide-icons/lucide>
- Packaged through: `lucide-react` 1.39.0
- License: ISC

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.

Some Lucide icons are derived from the Feather project and remain available
under the MIT License, copyright (c) 2013-present Cole Bemis. The Lucide package
identifies the derived icons in its bundled `LICENSE` file.

## UI and application runtime libraries

The distributed application includes or derives code from these projects:

| Project                                        | Version used for V1 | License           | Source                                        |
| ---------------------------------------------- | ------------------: | ----------------- | --------------------------------------------- |
| shadcn/ui CLI and generated component patterns |              4.19.1 | MIT               | <https://github.com/shadcn-ui/ui>             |
| Base UI React                                  |               1.7.0 | MIT               | <https://github.com/mui/base-ui>              |
| React and React DOM                            |              19.2.8 | MIT               | <https://github.com/facebook/react>           |
| Tailwind CSS                                   |               4.3.3 | MIT               | <https://github.com/tailwindlabs/tailwindcss> |
| class-variance-authority                       |               0.7.1 | Apache-2.0        | <https://github.com/joe-bell/cva>             |
| Tauri and Tauri Runtime                        |                 2.x | MIT OR Apache-2.0 | <https://github.com/tauri-apps/tauri>         |

Relevant upstream copyright notices include:

- Copyright (c) 2023 shadcn
- Copyright (c) 2019 Material-UI SAS (Base UI)
- Copyright (c) Meta Platforms, Inc. and affiliates (React)
- Copyright (c) Tailwind Labs, Inc.
- Copyright (c) 2017-present Tauri Apps Contributors

The MIT-licensed projects above are distributed under their respective notices
and MIT License terms. Apache-2.0 license terms are available at
<https://www.apache.org/licenses/LICENSE-2.0>. The authoritative license files
remain in each dependency's source distribution and should be included in any
future automated third-party license bundle.

## Project-owned visual assets

The Slate application icon and notification icon were introduced directly in
this repository by the project owner. The Chromium extension icons are raster
sizes derived from that existing application icon. No external logo or icon
asset was introduced for the V1 release-hardening work.
