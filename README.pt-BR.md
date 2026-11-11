# Agents Panel

[English](README.md) · **Português (Brasil)**

Painel lateral do Claude Code (no terminal) que mostra todos os agentes da sessão: o principal e cada subagente, com modelo, esforço, cronômetro, tokens e a ferramenta que está usando agora. Mostra também os shells abertos em segundo plano (Bash e PowerShell), até terminarem.

Cada moldura de subagente, a de **SHELLS** e a de **CONCLUÍDOS** têm um ✕ que fecha a moldura. Um subagente fechado volta quando trabalha de novo; um shell novo ou um subagente que termina depois traz a moldura de volta só com o item novo. A moldura **Principal** não tem ✕.

O painel abre sozinho quando a janela do terminal tem 144 colunas ou mais; em qualquer largura, `/painel-agentes` abre o painel. Foi feito e testado com `"tui": "fullscreen"` em `~/.claude/settings.json`.

## Planos

Numa tarefa com mais do que alguns passos, o Claude escreve um plano (etapas com passos) e o move enquanto trabalha. O plano aparece dentro da moldura do agente que o criou: o plano da conversa principal na moldura do **Principal**, o plano de um subagente na moldura desse subagente.

- A primeira linha tem o título do plano e um selo com o estado e o tempo: verde em andamento, âmbar aguardando a sua resposta, vermelho com erro, verde-azulado quando concluído.
- Uma barra ocupa a largura da moldura, com a etapa atual, o passo e a porcentagem na cápsula.
- Uma etapa já concluída vira uma linha só, com o tempo total; a etapa atual mostra cada passo.
- Os planos que a conversa principal já concluiu ficam embaixo do atual, uma linha cada.
- Quando um subagente termina, o plano concluído dele vai junto para **CONCLUÍDOS**; um plano que ficou aberto passa para a moldura do **Principal**.

Um plano aprovado no plan mode vira o plano `plan` na moldura do **Principal**. Os planos da conversa principal ficam salvos por sessão e voltam quando você reabre a sessão.

**Desinstale o plan-progress** se você o tiver: este painel agora faz o que ele fazia. Com os dois instalados, o Claude teria duas ferramentas de plano e informaria cada passo duas vezes.

```
claude plugin uninstall plan-progress
```

## Instalar num computador novo

O Agents Panel se instala pelo seu identificador, `agents-panel`, a partir do [WPC Mods for Claude](https://github.com/carreirodev/wpc-mods-claude/blob/main/README.pt-BR.md), o marketplace com todos os meus mods. Há dois jeitos, e os dois fazem a mesma coisa: escolha um.

**Dentro do Claude Code**, numa sessão, digite:

```
/plugin install agents-panel --marketplace carreirodev/wpc-mods-claude
```

Responda `y` para adicionar o marketplace e escolha o escopo de usuário (o primeiro da lista) com Enter. A mensagem `Installed agents-panel` confirma.

**Pelo terminal**, fora do Claude Code, rode um comando e depois o outro:

```
claude plugin marketplace add carreirodev/wpc-mods-claude
```

```
claude plugin install agents-panel@wpc-mods-claude
```

Aqui o escopo de usuário já é o padrão, então não há nada para escolher.

De um jeito ou do outro, o painel funciona a partir daí, em toda sessão nova; numa sessão que já estava aberta, rode `/reload-plugins`.

Para receber uma versão nova depois: `/plugin marketplace update wpc-mods-claude` numa sessão.

Instalou antes pelo marketplace deste repositório (`agents-panel@agents-panel`)? Essa cópia continua atualizando como antes. Para trocar, siga [estes passos](https://github.com/carreirodev/wpc-mods-claude/blob/main/README.pt-BR.md#se-você-já-instalou-um-mod-pelo-repositório-dele); não fique com as duas, porque só uma roda.

## Editar o mod

Para mexer no mod, use a pasta clonada em vez da instalação acima (um jeito ou o outro, não os dois):

1. Clone o repositório nessa pasta:

   ```
   git clone https://github.com/carreirodev/mod-painel-agents.git C:\Users\SEU_USUARIO\mods\agents-panel
   ```

2. Em `~/.claude/settings.json`, no bloco `env`, aponte para essa pasta:

   ```json
   "env": {
     "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\SEU_USUARIO\\mods\\agents-panel"
   }
   ```

3. Abra uma sessão nova. Daí em diante, cada mudança salva na pasta recarrega o mod ao fim da resposta do Claude.

Antes de subir uma mudança, rode na pasta do mod:

```
claude plugin validate .
claude plugin test .
```

E aumente `version` em `.claude-plugin/plugin.json`: os computadores que instalaram pelo marketplace só recebem a mudança quando a versão muda.
