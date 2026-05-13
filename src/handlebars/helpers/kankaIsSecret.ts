import isSecret from '../../util/isSecret';

export default function kankaIsSecret(...argsWithOptions: unknown[]): boolean {
    // The last argument is the Handlebars HelperOptions — exclude it.
    const entities = argsWithOptions.slice(0, -1);
    return isSecret(...entities);
}
