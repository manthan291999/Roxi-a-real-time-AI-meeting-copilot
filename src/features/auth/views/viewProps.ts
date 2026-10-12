import type { SignInMethods } from '../../../shared/types/account';
import type { AuthFlow } from '../flow/types';

/** What every view is handed: the flow, plus which browser sign-in options exist. */
export type AuthViewProps = AuthFlow & { methods: SignInMethods };

/** What a view needs to show server errors, notices and their recovery actions. */
export type FeedbackProps = Pick<AuthFlow, 'error' | 'notice' | 'busy' | 'cooldown' | 'switchMode' | 'resendConfirmation'>;

/** What a view with a form needs on top of that. */
export type FormViewProps = FeedbackProps & Pick<AuthFlow, 'values' | 'setField' | 'fieldErrors' | 'submit'>;

/** A form view that also offers the browser sign-in buttons. */
export type EntryViewProps = FormViewProps & Pick<AuthViewProps, 'methods' | 'startProvider'>;
