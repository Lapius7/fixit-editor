<div align="center">

<img src="docs/screenshots/banner.png" alt="Fixit Editor" width="100%">

# Fixit Editor

**가볍고 보기 좋은, 반투명 유리 느낌의 Windows용 코드 에디터.**

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4)
![Built with](https://img.shields.io/badge/built%20with-Tauri%20%C2%B7%20React%20%C2%B7%20CodeMirror%206-444)

[웹사이트](https://fixit-editor.lapius7.com) · [문서](https://fixit-editor.lapius7.com/docs) · [변경 내역](https://fixit-editor.lapius7.com/changelog) · [라이선스](#라이선스)

[English](README.md) · [日本語](README.ja.md) · **한국어** · [简体中文](README.zh-CN.md) · [Español](README.es.md)

</div>

## 개요

Fixit Editor는 반투명 유리 느낌의 작은 코드 에디터입니다. 설치 프로그램 없이 `Fixit-Editor.exe` 파일 하나로 실행됩니다. CodeMirror 6와 Tauri로 만들어 빠르게 시작하고 가볍게 동작합니다.

설정, 통계, 워크스페이스는 이 PC에 저장됩니다. AI에 질문하거나 익명 사용 횟수 전송을 허용한 경우를 제외하면, 코딩 내용은 밖으로 나가지 않습니다.

<p align="center">
  <img src="docs/screenshots/en-light.png" alt="라이트 모드의 Fixit Editor" width="49%">
  <img src="docs/screenshots/en-dark.png" alt="다크 모드의 Fixit Editor" width="49%">
</p>

## 기능

**편집**

- 폴더를 하나 또는 여러 개 열어 구문 강조, 자동 완성, 검색과 함께 편집합니다(CodeMirror 6).
- 화면 분할, 전체 검색, 명령 팔레트, 빠른 열기를 지원합니다.
- 이미지, PDF, Word, 오디오, 비디오를 열 수 있습니다. Markdown과 HTML은 소스 옆에서 미리 볼 수 있습니다.
- 터미널을 여러 개 열 수 있고, 탭 이름도 바꿀 수 있습니다.

**원격과 워크스페이스**

- WSL과 SSH 폴더를 PC의 폴더처럼 엽니다. 목록, 편집, 저장, 이름 변경, 삭제, 검색, 터미널을 쓸 수 있습니다. CRLF 파일은 줄바꿈을 유지한 채 저장합니다.
- 워크스페이스는 폴더, 탭, 분할, 터미널을 함께 저장하고 다음 실행 때 되돌려 놓습니다.
- 프로파일은 모양, 각종 설정, 단축키를 한 묶음으로 관리합니다. 이름을 붙여 전환하거나 워크스페이스에 연결할 수 있고, 파일로 내보내고 가져올 수도 있습니다.

**모양과 사용감**

- 라이트, 다크, OS 설정 따르기를 선택할 수 있습니다. 배경은 색 메시이며, 점을 끌어서 만듭니다.
- 설정이 120개 이상 있습니다. 검색, "변경한 것만" 필터, 항목별 초기화, JSON 내보내기와 가져오기를 지원합니다.
- 단축키는 70개 이상이며 바꿀 수 있습니다.
- 일본어, 영어, 한국어 화면을 지원합니다.

**AI는 질문할 때만**

- 선택한 코드나 열려 있는 파일에 대해 질문할 수 있습니다. 자신의 Anthropic / OpenAI API 키를 쓰거나, 공식 `claude` 명령으로 Claude 구독 로그인을 쓸 수 있습니다.
- 각 제공자에게 처음 보내기 전에 동의 화면이 나옵니다.

<p align="center">
  <img src="docs/screenshots/en-split.png" alt="화면 분할" width="49%">
  <img src="docs/screenshots/en-palette.png" alt="명령 팔레트" width="49%">
</p>

## 개인정보

밖으로 나가는 것은 다음 두 가지뿐이며, 직접 조작했거나 설정에서 허용한 경우에만 보냅니다. 코딩 통계는 밖으로 보내지 않습니다.

- **AI 질문:** 선택 영역, 열려 있는 파일, 입력한 문장을 선택한 제공자에게 보냅니다.
- **익명 사용 횟수:** 하루에 한 번, 임의의 ID, 앱 버전, OS 종류, 언어를 보냅니다. 설정과 첫 실행 설정에서 끌 수 있습니다.

## 소스에서 빌드

pnpm과, `x86_64-pc-windows-gnu` 타깃이 설치된 Rust가 필요합니다. Windows용 exe는 WSL 또는 Linux에서 빌드합니다.

```bash
pnpm install
bash scripts/build-win.sh   # dist-win/Fixit-Editor.exe 가 만들어집니다
```

## 라이선스

[MIT](LICENSE)
