import { GradientText } from '../primitives/GradientText';
const questions = [['Precisa de conta?', 'Para entrar numa sala com link ou código, não. Para criar salas e comunidades, uma conta rápida.'], ['Quanto custa?', 'Nada. O Scale é gratuito.'], ['Quantas pessoas cabem?', 'Até 8 por sala de voz.'], ['Minha voz passa pelo servidor?', 'Não. Áudio e tela vão direto entre os participantes; o servidor cuida do login, da conexão e do texto.'], ['Preciso instalar?', 'Não. Funciona no navegador, e dá para instalar como app se quiser.']];
export function Faq() {
  return <section className="l-faq l-section">
    <h2>Alguma <GradientText>dúvida?</GradientText></h2>
    <div>
      {questions.map(([q, a]) => <details key={q}>
        <summary>
          {q}
          <span aria-hidden="true">+</span>
        </summary>
        <p>
          {a}
        </p>
      </details>)}
    </div>
  </section>;
}
