# Changelog

## [0.2.4](https://github.com/Poonsai/pfmon/compare/v0.2.3...v0.2.4) (2026-05-18)


### Bug Fixes

* don't crash the poller when OUI/GeoIP files are missing ([7a82bd5](https://github.com/Poonsai/pfmon/commit/7a82bd539ec2ed3e8f68bf3d1f9a9f425015aa8a))
* prune uptime_events, show true bandwidth/s, escape LIKE wildcards ([5a4ead2](https://github.com/Poonsai/pfmon/commit/5a4ead2d6d135a92a776b2bcbf29fc8d09d2b293))

## [0.2.3](https://github.com/Poonsai/pfmon/compare/v0.2.2...v0.2.3) (2026-05-18)


### Bug Fixes

* harden traffic accounting, poller lifecycle, and alert delivery ([1012aa5](https://github.com/Poonsai/pfmon/commit/1012aa5530e5523888660aac4856b7b50b70e8c4))
* live WAN and per-device traffic stats (pfRest 2.8 compatibility) ([1da0b6f](https://github.com/Poonsai/pfmon/commit/1da0b6fa12d254b0fb86e5b89fbf611519ad2cb5))
* populate WAN and per-device traffic stats live ([1627b45](https://github.com/Poonsai/pfmon/commit/1627b45dc0e967616d1ba99fb1e231e62ffa0241))
* swap per-device rx/tx semantic in firewall_states aggregation ([ff9f3cd](https://github.com/Poonsai/pfmon/commit/ff9f3cd58b1ce5921cafda68d501af63ca151942))

## [0.2.2](https://github.com/Poonsai/pfmon/compare/v0.2.1...v0.2.2) (2026-05-18)


### Bug Fixes

* classify interfaces by pfRest id, compute real network address, skip disabled ([e23920e](https://github.com/Poonsai/pfmon/commit/e23920e1a4b22ec733e42599887a62c8eb0c65df))

## [0.2.1](https://github.com/Poonsai/pfmon/compare/v0.2.0...v0.2.1) (2026-05-18)


### Bug Fixes

* align pfRest endpoint paths to pfRest 2.8.0-RELEASE ([cc28c9f](https://github.com/Poonsai/pfmon/commit/cc28c9f60fc939dd0fafc39a455ec85865cbdcc9))

## [0.2.0](https://github.com/Poonsai/pfmon/compare/v0.1.0...v0.2.0) (2026-05-18)


### Features

* alerts banner fragment for new devices and poll failures ([3c5021e](https://github.com/Poonsai/pfmon/commit/3c5021e4941aa31382120fadeaff88102c84b259))
* db connection with WAL + statement-split migrations runner ([ec45e55](https://github.com/Poonsai/pfmon/commit/ec45e55f8a28f49a74e0ec5e69abd36d3428f95f))
* device detail fragment with traffic + uptime SVG charts ([1041a94](https://github.com/Poonsai/pfmon/commit/1041a941336c26a62109bb843dc7f43eb8873137))
* device list fragment with search, status, VLAN, sort filters ([d99e355](https://github.com/Poonsai/pfmon/commit/d99e35509afb4cad6f83c51939f74f58f5949a46))
* device upserts + uptime transitions ([5e421d8](https://github.com/Poonsai/pfmon/commit/5e421d84112e7c5a62236beb3bde19ad3e4f0534))
* device-type rule engine ([e964aac](https://github.com/Poonsai/pfmon/commit/e964aac6cc1554149c5f523204301801a5f64d8e))
* geo_connections upserts + firewall_blocks with dedupe ([8d5b01b](https://github.com/Poonsai/pfmon/commit/8d5b01b9e7563adbd0ebae094a9a8ca95f46d630))
* header-meta fragment with device counts and poll freshness ([ff7eff7](https://github.com/Poonsai/pfmon/commit/ff7eff7b86dd587fee9b8dd1acaf6bdb8fd459cb))
* initial SQLite schema covering devices, traffic, blocks, geo, counters ([f03824f](https://github.com/Poonsai/pfmon/commit/f03824f13b9628ec90a32111ee31f56db83b1465))
* mac vendor (OUI) lookup module ([5a82c6b](https://github.com/Poonsai/pfmon/commit/5a82c6bd93932bb767d75e1806b31650ce15e27e))
* minimal Express server with /api/health endpoint ([d7e0c0c](https://github.com/Poonsai/pfmon/commit/d7e0c0ca17ba54bc42ec516fe33dfd04b9e9c2c5))
* ntfy.sh alerts for new devices with grace period ([01fda04](https://github.com/Poonsai/pfmon/commit/01fda0440e8986c21757f23363dd13ededbc9343))
* offline IPv4-to-country lookup via binary search on sorted ranges ([6feea9e](https://github.com/Poonsai/pfmon/commit/6feea9e668574e4c5a0612d9e4edf9581386699c))
* page shell layout with HTMX wiring and anti-FOUC theme script ([ec7a424](https://github.com/Poonsai/pfmon/commit/ec7a42449a4c49e0225176ba3b2a1b30eab2d2b2))
* PATCH /devices/:id/nickname inline edit ([b161035](https://github.com/Poonsai/pfmon/commit/b161035d3b0ef990137a91da5d2ff6cfa8edb4b4))
* PATCH /devices/:id/notes inline edit ([cbb7898](https://github.com/Poonsai/pfmon/commit/cbb78986f25c7dbdd72967b733f513be736211cc))
* pfRest HTTP client with X-API-Key auth and configurable TLS verify ([aded83f](https://github.com/Poonsai/pfmon/commit/aded83f3ac8196a551716a5b8a6f67d00fa48a0f))
* poller orchestrator with cron schedule + exponential backoff ([30e6147](https://github.com/Poonsai/pfmon/commit/30e61475c0bcc03ba7576e6d0be870140e65bc8d))
* populate VLAN dropdown from interfaces table ([e97bb37](https://github.com/Poonsai/pfmon/commit/e97bb3787802c6d7b4e582934a572c01b2ba7753))
* POST /devices/:id/dismiss-new clears NEW badge ([4c98fe7](https://github.com/Poonsai/pfmon/commit/4c98fe72c506bbf5a77a939bf59356a94d4424d6))
* POST/DELETE /devices/:id/tags for tag management ([8d1a619](https://github.com/Poonsai/pfmon/commit/8d1a619aa9992fc30f8f50335356b360e282a801))
* reconcile.syncInterfaces upsert ([deb1df1](https://github.com/Poonsai/pfmon/commit/deb1df1d1714d5861096d2ac0620d1a7ad8b0566))
* register EJS view engine + static file serving ([f641417](https://github.com/Poonsai/pfmon/commit/f641417a19530138de525a8219a927902020070b))
* retention prune + hourly + daily rollups ([0101f2a](https://github.com/Poonsai/pfmon/commit/0101f2ad364c43fe56a634a4ed8be2cc9b366b68))
* snapshot builder merges pfSense sources into per-MAC rows ([d37de25](https://github.com/Poonsai/pfmon/commit/d37de25a1ff850011af7ecd696c00c1aa3337b60))
* theme toggle script with localStorage + prefers-color-scheme ([0acb31d](https://github.com/Poonsai/pfmon/commit/0acb31d633114a25d7eea1c83855f2766127b35d))
* theme tokens and base stylesheet with light + dark variants ([e427dbf](https://github.com/Poonsai/pfmon/commit/e427dbf6faa3ed54355d40612a29052fa11e7f68))
* traffic + interface traffic samples with delta computation ([b90ae61](https://github.com/Poonsai/pfmon/commit/b90ae61eaf53946624b064acc48f40a40ca56e8a))
* WAN summary fragment with today/week/month totals and 24h SVG chart ([d0f4a94](https://github.com/Poonsai/pfmon/commit/d0f4a944e99b7b0af119da523d1f58a118cbfbad))
* wire poller orchestrator into Express bootstrap with initial sync ([a4c13f3](https://github.com/Poonsai/pfmon/commit/a4c13f3fa347b7b7c832d1c2ec4895d1b1fa522e))


### Bug Fixes

* regenerate lockfile with undici v6 and document install strategy ([aafef52](https://github.com/Poonsai/pfmon/commit/aafef52b025d4ebe0cbf39791b47557c3d601831))
* resolve Docker build and runtime issues ([e8fc510](https://github.com/Poonsai/pfmon/commit/e8fc510f0056fc2ab0315213ec46b99fc7275c8d))
* validate version in release-docker workflow_dispatch path ([26a8b2b](https://github.com/Poonsai/pfmon/commit/26a8b2bb42eee30c754f12f30c05c264334fc0f4))

## Changelog
