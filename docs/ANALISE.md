# Escuta Só! — análise para a versão 3

Este documento registra o que o jogo cobre até a versão 2.0.1, as lacunas encontradas e o que entra na versão 3. Pesquisei referências em qualquer idioma, mas as palavras, os pares e as regras do jogo seguem a fonologia e a ortografia do português brasileiro. Nenhuma lista foi traduzida do inglês, e nenhum código ou conteúdo de terceiros foi copiado.

## 1. Referências consultadas

| Referência | O que aproveitei (como ideia) |
|---|---|
| Hierarquia auditiva de Erber: detecção → discriminação → identificação → compreensão. Referências: [Clarke Schools](https://www.clarkeschools.org/clarke-speaks-up/auditory-hierarchy/), [Programa de estimulação das habilidades auditivas, CoDAS](https://www.scielo.br/j/codas/a/5j7Crjs6pvmQ9pnhzYWRLSS/?lang=pt) e [material da UNA-SUS](https://ares.unasus.gov.br/acervo/html/ARES/27355/1/Desenvolvimento%20auditivo%20infantil.pdf) | Organizar as atividades por nível e mostrar onde cada uma se encaixa. |
| Etapas da terapia de pares mínimos: familiarização → discriminação → identificação → produção. Referências: [Minimal Pairs Arcade](https://apps.apple.com/us/app/-/id1666370717) (cartões de familiarização antes dos jogos) e [Minimal Pairs Academy](https://apps.apple.com/us/app/id483691470) (bombardeio auditivo, discriminação e produção) | A tela "Conheça as palavras" antes de um par novo e a atividade de produção "Eu falo, você ouve". |
| [lobau/pairs](https://github.com/lobau/pairs) (GPL-2.0, **só a ideia, nenhum código**), que cita treino adaptativo de /r/–/l/ começando por estímulos fáceis (McClelland, Fiez e colegas) | A escada de dificuldade e a regra de subir e descer de nível. |
| Softwares brasileiros: Afinando o Cérebro e a triagem AudBility (ProBrain: [Forbes](https://forbes.com.br/forbes-tech/2021/09/healthtech-cria-games-que-estimulam-habilidades-cerebrais/), [Unicamp](https://www.prp.unicamp.br/inscricao-congresso/resumos/2020P17712A35485O5283.pdf)) e Escuta Ativa ([estudo](https://www.redalyc.org/pdf/3915/391544881039.pdf)) | Sessões em protocolo, numa sequência fixa por faixa etária; daí o **Plano de sessão**. Não encontrei fonte aberta que detalhe os módulos 6–8 / 9–12 do AudBility; usei a divisão que você indicou. |
| [CONFIAS](https://pepsic.bvsalud.org/pdf/psicoped/v38n116/12.pdf) (consciência fonológica para o PB): tarefas de identificação de fonema inicial e final e de rima | A progressão por posição (início → meio → fim) e a separação entre nível silábico e fonêmico. |
| Trabalhos sobre troca surda/sonora na alfabetização ([Revista Uningá](https://revista.uninga.br/uninga/article/download/441/102/1128) e outros) | A troca aparece na fala e na escrita; daí ligar o som à letra sem pista visual (Som secreto, Vibra ou sopra?, Qual letra faz esse som?). |
| Repositórios brasileiros pequenos no GitHub: [giovannaimperioo-ux/F-ou-V](https://github.com/giovannaimperioo-ux/F-ou-V), [yegor77/minigame-fonetico](https://github.com/yegor77/minigame-fonetico) (D/T e M/N), [JenniferNascimento0/JogodeConscienciaFonologica](https://github.com/JenniferNascimento0/JogodeConscienciaFonologica) | Confirmam o interesse em jogos de F/V e T/D, mas são protótipos com uma atividade só. Não trouxeram mecânicas novas. |

Citados por você, mas que não consegui verificar a fundo: LocuTour Minimal Pairs e o LEB adaptado para o PB. Sobre a escuta no ruído, que é o foco do LEB, o jogo já tem o "Ruído na escuta".

## 2. O que a versão 2 já cobre

### Pela hierarquia de Erber

| Nível | Atividades da v2 | Observação |
|---|---|---|
| Detecção | — | Não há tarefa de "tem som / não tem som". É pouco útil para trocas surdo/sonoro em crianças ouvintes, por isso **continua fora**. |
| Discriminação | Igual ou diferente?, Caça ao intruso | Só com palavras reais; sem sons isolados nem pseudopalavras. |
| Identificação | Qual eu falei?, Ajude o bichinho, Que som é esse?, Ruído na escuta, Som picotado, Missão relâmpago, Fone de ouvido | Sempre com **2 opções** e sempre o par inteiro. |
| Compreensão | Frase maluca | Só uma atividade, só para 9–11 anos. |
| (Consciência fonológica) | Qual rima?, Bate palminhas, Mesmo começo | Só para 4–5 anos; o som inicial é a única posição treinada. |
| (Memória e ordenação) | O bicho sumiu, Código secreto | Ok. |

### Pela unidade de fala

| Unidade | Cobertura na v2 |
|---|---|
| Fonema isolado | **Nenhuma.** Não há gravação de sons sozinhos. |
| Sílaba | Código secreto (ta–da) e Bate palminhas (contagem). |
| Palavra | A maior parte das atividades. |
| Frase | Só a Frase maluca. |
| Escrita | Letra escondida e Ditado detetive, só para 9–11 anos. |

### Faltava também

- **Posição do som:** nenhuma atividade pergunta onde o som está (início, meio, fim). O relatório não separa por posição.
- **Familiarização:** a criança já começa jogando, sem conhecer as palavras do par.
- **Produção:** não existe; a v2 é só percepção.

## 3. Lacunas

1. **Dificuldade:** os modos sem adaptação têm um nível só. Faltam:
   - variar o número de opções (2 → 3 → 4);
   - variar a posição do som;
   - tirar o apoio visual (figura + escrita → só figura → só som);
   - pseudopalavras.

   Também não existe uma escada que diga em que degrau a criança está em cada contraste.
2. **Distribuição por faixa:**
   - a faixa de 6–8 anos, a da alfabetização, não existe;
   - as atividades ficam presas a uma faixa (a de 4–5 não tem escrita; a de 9–11 não tem rima);
   - os Pequenos não têm frase nem compreensão; os Detetives não têm consciência silábica.
3. **Tipos de atividade:**
   - som isolado → letra, sem pista visual;
   - classificação por traço (vozeado × não vozeado);
   - posição do fonema na palavra;
   - produção com autoescuta.
4. **Gestão clínica:**
   - não dá para montar uma sessão em sequência;
   - as listas de palavras das atividades são fixas no código;
   - o relatório não mostra posição nem nível.

## 4. O que entra agora (v3)

### Pedidos da fono

- **Sons sozinhos** (gravação): /t/ /d/ /k/ /g/ /f/ /v/ /p/ /b/ /s/ /z/ /ʃ/ /ʒ/. A tela explica que fricativos podem ser prolongados e plosivos são um estalo curto. O recorte de silêncio fica mais sensível para não apagar o estalo.
- **Onde mora o som?**: palavra escrita com os dois espaços vazios (es_u_o). A criança arrasta T e D para o lugar certo. Tem botões de ouvir e de ouvir devagar (gravação a 0,75× ou voz sintética mais lenta).
- **Trem do som**: a versão sem letras, com 3 vagões (início, meio, fim). A criança põe o bichinho-som no vagão certo.
- **Som secreto**: desenha a letra com o dedo; a fono marca ✓/✗; o desenho fica no relatório.
- **Vibra ou sopra?** (🐝 × 🌬️): no fim da rodada, a revelação mostra a letra de cada som.
- **Qual letra faz esse som?**: teclado com o alfabeto completo.

### Validação das palavras pelo SOM, não pela letra

Regras usadas no código (`soundSlots`):

- **/k/** = `c` antes de a, o, u ou consoante, `qu` antes de e/i e `k`.
- **/g/** = `g` antes de a, o, u ou consoante e `gu` antes de e/i.
- `c` antes de e/i (/s/), `ç` e `g` antes de e/i (/ʒ/) **não** contam.
- **/t/ /d/ /f/ /v/ /p/ /b/** = a própria letra.

Revisão da lista que você mandou:

- **T/D:** todas válidas (estudo, tomada, ditado, tarde, dente, doente, tudo, todo, dentista, vestido, partida, atitude). *ditado*, *dentista* e *atitude* têm **3** lugares (d-t-d, d-t-t, t-t-d), por isso ficam no nível 2.
- **F/V:** todas válidas (favor, fivela, favela, ferver, fervura). Acrescentei *fava*, *festivo* e *favorito*.
- **K/G:** carga, cargo, colega e coringa são válidas. Acrescentei *cogumelo*, *escorrega* e *cangaço* (o ç é /s/ e não conta). **Recusadas pelo validador** (exemplos na ajuda): *cegonha* (c antes de e = /s/) e *tigela* (g antes de e = /ʒ/).
- **Trem do som:** a palavra precisa ter o som-alvo **uma vez só**.
  - *dado* (d no início e no fim) **não serve**. No lugar: *dente* (início), *medalha* (meio) e *nada* (fim).
  - *nada*, *sede*, *faca*, *sofá* e *chefe* servem como você indicou.
  - "Meio" exige palavra de 3 ou mais sílabas (ex.: *ca-dei-ra*, *e-le-fan-te*), porque nas de 2 sílabas o som está no início ou no fim.

### Escada de dificuldade

1. Familiarização
2. Igual/diferente
3. Identificação com 2 figuras
4. 3–4 opções
5. Fonema isolado e posição na palavra
6. Frases
7. Escrita
8. Ruído, filtro e sequência

- Cada atividade pertence a um degrau. A tela Rodada mostra a escada de cada contraste com a % de acerto em cada degrau.
- Cada atividade passa a ter **níveis** (número de opções, posição do som, apoio visual, pseudopalavras, sílabas, pausa).
- Regra: **sobe** com 80% ou mais em 2 rodadas seguidas e **volta** com menos de 50%. O ajuste é automático, e a fono pode **travar** o nível ou escolher outro.

### Outras novidades

- **Conheça as palavras** antes de um par novo (sem pontuação) e também como atividade do degrau 1.
- **Eu falo, você ouve**: produção com autoescuta. A fono marca certo, distorcido ou errado. Os áudios da criança ficam só no aparelho, não vão para o backup e podem ser apagados.
- **Listas editáveis** (rimas, Mesmo começo, Bate palminhas, Frase maluca, Onde mora o som e Trem do som), com o validador pelo som. Elas entram no backup.
- **Faixas sem gavetas fechadas:** a faixa só define o pacote e o nível inicial sugeridos; qualquer atividade pode ser liberada para qualquer criança.
- **Nova faixa 6–8 anos, "Exploradores das Letras"**: Trem do som, Vibra ou sopra?, Som secreto, Letra escondida, Onde mora o som (nível fácil) e Mesmo começo com as palavras escritas.
- **Plano de sessão**: por exemplo, aquecimento de 3 min → atividade-alvo → jogo livre, rodando em sequência sem voltar ao menu.
- **Relatório por posição (início, meio, fim) e por nível/degrau**, com gráfico. A posição é calculada também nas atividades de pares (onde o par difere: *pote/bote* = início; *nata/nada* = fim).
- **Pseudopalavras:** pares sem sentido que seguem a fonotática do PB (*tafo/dafo*, *tobi/dobi*, *cupi/gupi*, *fapo/vapo*, *fema/vema*, *pafi/bafi*). Conferi que nenhuma é palavra comum. Elas aparecem no nível mais alto de "Igual ou diferente?" e no "Qual eu falei?" escrito, para tirar a pista do significado. A fono pode editá-las como qualquer par.

## 5. O que fica de fora (e por quê)

- **Detecção** (presença/ausência de som): pouco útil para o objetivo clínico do jogo.
- **Reconhecimento automático da fala da criança**: exigiria mandar áudio para servidores ou modelos pesados, e o jogo não envia nada para a internet. Quem avalia a produção é a fono.
- **Onde mora o som?** para S/Z e CH/J: a ortografia é ambígua demais (s, ss, ç, c, x, z para /s/ e /z/; x, ch para /ʃ/; j, g para /ʒ/). O Trem do som e os sons sozinhos cobrem esses fonemas pelo som.
